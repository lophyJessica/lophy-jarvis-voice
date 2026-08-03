/**
 * 高置信 ASR 误听纠错（客户端兜底）。
 * 不能替代引擎热词；仅覆盖本项目反复出现的专有名词错听。
 */
const CORRECTIONS: Array<[RegExp, string]> = [
  [/给他哈尔滨|给她哈尔滨|给他哈而滨|给她哈而滨|给他哈弗|给她哈弗/g, 'GitHub'],
  [/所有的权限使用用腾讯app/gi, '所有的权限，使用腾讯云API'],
  [/使用用腾讯app/gi, '使用腾讯云API'],
  [/腾讯营app/gi, '腾讯云API'],
  [/嗯{3,}$/g, ''],
  [/权限使用用/g, '权限，使用'],
  [/调用papi/gi, '调用云API'],
  [/建议审慎使用\s*tls/gi, '建议始终使用TLS'],
  [/您的ap[im]要代表/gi, '您的API密钥代表'],
  [/API密钥o代表/gi, '您的API密钥代表'],
  [/\bapl\s*1代表/gi, '您的API密钥代表'],
  [/账号下所有腾讯资源/g, '账号下所有腾讯云资源'],
  [/调用mapr/gi, '调用云API'],
  [/^的您的API密钥/g, '您的API密钥'],
  [/零名下的/g, '账号下'],
  [/零名下/g, '账号下'],
  [/账号名下的/g, '账号下'],
  [/腾讯盈资源/g, '腾讯云资源'],
  [/所有的权限使用腾讯云/g, '所有的权限，使用腾讯云'],
  [/调用语音api/gi, '调用云API'],
  [/建议你使用使用/gi, '建议使用'],
  [/Apibl/gi, 'API密钥'],
  [/您的aple/gi, '您的API密钥'],
  [/您的apm/gi, '您的API密钥'],
  [/\bApm\s*1代表/gi, '您的API密钥代表'],
  [/\bApm\s*1(?=代表)/gi, '您的API密钥'],
  [/建议什么使用\s*tos/gi, '建议始终使用TLS'],
  [/建议始终使用tos/gi, '建议始终使用TLS'],
  [/使用tos\s*1\.2/gi, '使用TLS 1.2'],
  [/腾讯营api/gi, '腾讯云API'],
  [/所有的腾讯资源/g, '所有的腾讯云资源'],
  [/分享您的重要信息/g, '分享您的密钥信息'],
  [/分享您的没有信息/g, '分享您的密钥信息'],
  [/调用云api/gi, '调用云API'],
  [/调用于api/gi, '调用云API'],
  [/建议使用使用\s*tls/gi, '建议使用TLS'],
  [/水泵使用/g, '始终使用'],
  [/\bMaple\b[，,]\s*/gi, '您的API密钥'],
  [/\bMaple\b/gi, 'API密钥'],
  [/\bamber\b/gi, 'API密钥'],
  [/腾讯与资源/g, '腾讯云资源'],
  [/腾讯云姿/g, '腾讯云资源'],
  [/(?:账号|帐号|零零|00)下/g, '账号下'],
  [/定期更换必要/g, '定期更换密钥'],
  [/分享您的必要信息/g, '分享您的密钥信息'],
  [/分享您的密码信息/g, '分享您的密钥信息'],
  [/安全设计策略/g, '安全设置策略'],
  [/调用云api与安全风险/gi, '调用云API有安全风险'],
  [/调用语音api有安全风险/gi, '调用云API有安全风险'],
  [/建议什么使用\s*tls/gi, '建议始终使用TLS'],
  [/使用低版本[，,]\s*tls/gi, '使用HTTPS/TLS'],
]

export function correctAsrText(text: string): string {
  if (!text) return text
  return CORRECTIONS.reduce((result, [pattern, replacement]) => (
    result.replace(pattern, replacement)
  ), text)
}
