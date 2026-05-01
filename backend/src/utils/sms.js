const Dypnsapi20170525 = require('@alicloud/dypnsapi20170525');
const OpenApi = require('@alicloud/openapi-client');
const Util = require('@alicloud/tea-util');
const config = require('../config');

let client = null;

/**
 * 获取阿里云号码认证服务客户端（单例）
 */
function getClient() {
  if (client) return client;

  const { accessKeyId, accessKeySecret } = config.aliyunSms;
  if (!accessKeyId || !accessKeySecret) {
    throw new Error('阿里云 AccessKey 未配置，请设置 ALIBABA_CLOUD_ACCESS_KEY_ID 和 ALIBABA_CLOUD_ACCESS_KEY_SECRET 环境变量');
  }

  const openApiConfig = new OpenApi.Config({
    accessKeyId,
    accessKeySecret,
  });
  openApiConfig.endpoint = 'dypnsapi.aliyuncs.com';

  client = new Dypnsapi20170525.default(openApiConfig);
  return client;
}

/**
 * 发送短信验证码
 * @param {string} phone - 手机号
 * @returns {Promise<object>} 发送结果
 */
async function sendSmsVerifyCode(phone) {
  const dypnsClient = getClient();
  const { signName, templateCode, codeLength, validTime } = config.aliyunSms;

  const request = new Dypnsapi20170525.SendSmsVerifyCodeRequest({
    phoneNumber: phone,
    signName,
    templateCode,
    templateParam: JSON.stringify({ code: '##code##' }),
    codeLength,
    validTime,
    codeType: 1, // 纯数字
    interval: 60, // 60 秒频控
  });

  const runtime = new Util.RuntimeOptions({});
  const response = await dypnsClient.sendSmsVerifyCodeWithOptions(request, runtime);

  if (!response.body.success || response.body.code !== 'OK') {
    console.error('[SMS] SendSmsVerifyCode failed:', response.body);
    throw new Error(response.body.message || '短信验证码发送失败');
  }

  console.log(`[SMS] 验证码已发送至 ${phone}, bizId=${response.body.model?.bizId}`);
  return { message: '验证码已发送' };
}

/**
 * 校验短信验证码
 * @param {string} phone - 手机号
 * @param {string} code - 用户输入的验证码
 * @returns {Promise<boolean>} 校验是否通过
 */
async function checkSmsVerifyCode(phone, code) {
  const dypnsClient = getClient();

  const request = new Dypnsapi20170525.CheckSmsVerifyCodeRequest({
    phoneNumber: phone,
    verifyCode: code,
  });

  const runtime = new Util.RuntimeOptions({});
  const response = await dypnsClient.checkSmsVerifyCodeWithOptions(request, runtime);

  if (!response.body.success || response.body.code !== 'OK') {
    console.error('[SMS] CheckSmsVerifyCode failed:', response.body);
    throw new Error(response.body.message || '验证码校验请求失败');
  }

  const verifyResult = response.body.model?.verifyResult;
  console.log(`[SMS] 校验结果: phone=${phone}, result=${verifyResult}`);
  return verifyResult === 'PASS';
}

module.exports = {
  sendSmsVerifyCode,
  checkSmsVerifyCode,
};
