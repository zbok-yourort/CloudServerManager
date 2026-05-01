const prisma = require('../db/prisma');
const { hashPassword } = require('../utils/crypto');
const { generateAccessToken, generateRefreshToken } = require('../utils/jwt');
const { sendSmsVerifyCode, checkSmsVerifyCode } = require('../utils/sms');

// In-memory stores (replace with Redis in production)
const tokenBlacklist = new Set(); // blacklisted accessTokens
const resetTokenStore = new Map(); // token -> { userId, expiresAt }

class AuthService {
  async register(email, password) {
    // 检查邮箱是否已存在
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new Error('该邮箱已被注册');
    }

    // 创建用户
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        account: {
          create: {
            balance: 0,
            frozenAmount: 0
          }
        }
      },
      include: { account: true }
    });

    // 生成 Token
    const accessToken = generateAccessToken(user.id);
    const refreshTokens = generateRefreshToken(user.id);

    return {
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt
      },
      accessToken,
      refreshToken: refreshTokens
    };
  }

  async login(email, password) {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { account: true }
    });

    if (!user) {
      throw new Error('邮箱或密码错误');
    }

    const { comparePassword } = require('../utils/crypto');
    const isValid = await comparePassword(password, user.passwordHash);
    if (!isValid) {
      throw new Error('邮箱或密码错误');
    }

    const accessToken = generateAccessToken(user.id);
    const refreshTokens = generateRefreshToken(user.id);

    return {
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt
      },
      accessToken,
      refreshToken: refreshTokens,
      account: user.account
    };
  }

  async refresh(refreshToken) {
    const { verifyToken } = require('../utils/jwt');
    const decoded = verifyToken(refreshToken);

    if (!decoded || decoded.type !== 'refresh') {
      throw new Error('无效的 Refresh Token');
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { account: true }
    });

    if (!user) {
      throw new Error('用户不存在');
    }

    const newAccessToken = generateAccessToken(user.id);
    const newRefreshToken = generateRefreshToken(user.id);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken
    };
  }

  async sendSmsCode(phone) {
    return await sendSmsVerifyCode(phone);
  }

  async verifySmsCode(phone, code) {
    const passed = await checkSmsVerifyCode(phone, code);
    if (!passed) {
      throw new Error('验证码错误或已过期');
    }

    // Find user by phone
    let user = await prisma.user.findFirst({ where: { phone } });

    if (!user) {
      throw new Error('该手机号未注册');
    }

    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    return {
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone
      },
      accessToken,
      refreshToken
    };
  }

  async logout(accessToken) {
    tokenBlacklist.add(accessToken);
    return { message: '已退出登录' };
  }

  isTokenBlacklisted(token) {
    return tokenBlacklist.has(token);
  }

  async forgotPassword(email) {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      // Security: don't reveal if email exists
      return { message: '如果邮箱存在，已发送重置链接' };
    }

    // Generate reset token (6-char random string)
    const resetToken = Math.random().toString(36).substring(2, 8).toUpperCase();
    const expiresAt = Date.now() + 30 * 60 * 1000; // 30 minutes

    resetTokenStore.set(resetToken, { userId: user.id, expiresAt });

    // In production, send email with reset link
    console.log(`[Email] Mock reset link for ${email}: token=${resetToken}`);

    return { message: '如果邮箱存在，已发送重置链接', resetToken }; // Remove resetToken in production
  }

  async resetPassword(token, newPassword) {
    const record = resetTokenStore.get(token);

    if (!record) {
      throw new Error('无效的重置令牌');
    }

    if (Date.now() > record.expiresAt) {
      resetTokenStore.delete(token);
      throw new Error('重置令牌已过期');
    }

    const passwordHash = await hashPassword(newPassword);

    await prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash }
    });

    resetTokenStore.delete(token);

    return { message: '密码重置成功' };
  }

  async phoneRegister(phone, code) {
    // Verify SMS code via Alibaba Cloud
    const passed = await checkSmsVerifyCode(phone, code);
    if (!passed) {
      throw new Error('验证码错误或已过期');
    }

    // Check if phone already registered
    const existingUser = await prisma.user.findFirst({ where: { phone } });
    if (existingUser) {
      throw new Error('该手机号已被注册');
    }

    // Create user without email (email is optional for phone-only users)
    const user = await prisma.user.create({
      data: {
        phone,
        account: {
          create: {
            balance: 0,
            frozenAmount: 0
          }
        }
      },
      include: { account: true }
    });

    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    return {
      user: {
        id: user.id,
        phone: user.phone
      },
      accessToken,
      refreshToken
    };
  }

  // OAuth placeholder methods
  async oauthAuthorize(provider) {
    // In production, return actual OAuth URL for the provider
    const urls = {
      wechat: 'https://open.weixin.qq.com/connect/qrconnect?appid=YOUR_APPID&redirect_uri=YOUR_CALLBACK&response_type=code&scope=snsapi_login&state=STATE',
      feishu: 'https://open.feishu.cn/open-apis/authen/v1/authorize?app_id=YOUR_APP_ID&redirect_uri=YOUR_CALLBACK&state=STATE'
    };

    if (!urls[provider]) {
      throw new Error('不支持的第三方登录方式');
    }

    return { authUrl: urls[provider] };
  }

  async oauthCallback(provider, code) {
    // In production: exchange code for access token, get user info, create/login user
    console.log(`[OAuth] Callback from ${provider} with code: ${code}`);

    return {
      message: '第三方登录功能预留，请后续配置真实的 OAuth App',
      provider,
      code
    };
  }

  async userInfo(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        createdAt: true
      }
    });

    if (!user) {
      throw new Error('用户不存在');
    }

    return user;
  }
}

module.exports = new AuthService();
