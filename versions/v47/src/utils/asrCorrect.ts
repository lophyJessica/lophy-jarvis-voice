/**
 * 高置信 ASR 误听纠错（客户端兜底）。
 * 不能替代引擎热词；仅覆盖本项目反复出现的专有名词错听。
 */
const CORRECTIONS: Array<[RegExp, string]> = [
  [/给他哈尔滨|给她哈尔滨|给他哈而滨|给她哈而滨/g, 'GitHub'],
  [/您的aple/gi, '您的API密钥'],
  [/腾讯营api/gi, '腾讯云API'],
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
  [/调用云api与安全风险/gi, '调用语音API有安全风险'],
  [/调用语音api有安全风险/gi, '调用语音API有安全风险'],
  [/建议什么使用\s*tls/gi, '建议始终使用TLS'],
  [/使用低版本[，,]\s*tls/gi, '使用HTTPS/TLS'],
]

export function correctAsrText(text: string): string {
  if (!text) return text
  return CORRECTIONS.reduce((result, [pattern, replacement]) => (
    result.replace(pattern, replacement)
  ), text)
}
