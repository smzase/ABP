import {
  PUBLISH_SITES,
  type GroupAccount,
  type PublishSite,
  type SiteAccountConfig,
  type SiteAccounts,
  type SiteCheckResult
} from './types.ts'

export const SITE_LABELS: Record<PublishSite, string> = {
  anibt: 'AniBT',
  mikan: '蜜柑计划',
  nyaa: 'Nyaa',
  dmhy: '动漫花园',
  acgnxAsia: '末日动漫',
  acgnxGlobal: 'AcgnX',
  bangumiMoe: '萌番组',
  acgrip: 'ACG.RIP'
}

/** 设置页与连通性检测共用的站点入口，避免 UI 展示地址和实际检测地址各写一份。 */
export const SITE_URLS: Record<PublishSite, string> = {
  anibt: 'https://anibt.net',
  mikan: 'https://mikanani.me',
  nyaa: 'https://nyaa.si',
  dmhy: 'https://share.dmhy.org',
  acgnxAsia: 'https://share.acgnx.se',
  acgnxGlobal: 'https://www.acgnx.se',
  bangumiMoe: 'https://bangumi.moe',
  acgrip: 'https://acg.rip'
}

export const SITE_DESCRIPTION_FORMAT: Record<PublishSite, 'markdown' | 'html' | 'bbcode'> = {
  anibt: 'markdown',
  mikan: 'bbcode',
  nyaa: 'markdown',
  dmhy: 'html',
  acgnxAsia: 'html',
  acgnxGlobal: 'html',
  bangumiMoe: 'html',
  // ACG.RIP accepts Markdown inside [markdown] blocks.
  acgrip: 'markdown'
}

/** ACG.RIP 文档展示 tpx:// 链接，但 HTTP API 的 X-API-TOKEN 只接收链接末尾的裸 Token。 */
export function normalizeAcgripToken(value: string): string {
  return value.trim().replace(/^tpx:\/\/(?:www\.)?acg\.rip\/+/i, '')
}

function cleanResponseMessage(raw: string, fallback: string): string {
  const text = raw.trim()
  if (!text) return fallback
  try {
    const value = JSON.parse(text) as Record<string, unknown>
    for (const key of ['error', 'message', 'value', 'detail']) {
      if (typeof value[key] === 'string' && value[key]) return value[key]
    }
  } catch {
    // Fall back to a compact text response below.
  }
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) || fallback
}

export function evaluateDmhyLoginResponse(raw: string): { ok: boolean; message: string } {
  if (/登入成功|登录成功/.test(raw)) return { ok: true, message: '登录成功' }
  if (/帳戶密碼錯誤|帐户密码错误|账户密码错误/.test(raw)) return { ok: false, message: '账号或密码错误' }
  if (/驗證碼錯誤|验证码错误/.test(raw)) return { ok: false, message: '验证码错误，请重新输入' }
  return { ok: false, message: cleanResponseMessage(raw, '登录失败，站点未返回可识别的结果') }
}

/** 这些站点只提供有发布副作用的上传端点，不能用空发布请求冒充凭据验证。 */
export function unavailableCredentialCheck(
  site: 'mikan' | 'acgrip' | 'acgnxAsia' | 'acgnxGlobal'
): SiteCheckResult {
  if (site === 'mikan') {
    return { ok: true, verified: false, message: 'API Token 已填写；蜜柑未提供独立验证接口，将在实际发布时验证' }
  }
  if (site === 'acgrip') {
    return { ok: true, verified: false, message: 'API Token 已填写；ACG.RIP 未提供无副作用的验证接口，将在实际发布时验证' }
  }
  return {
    ok: true,
    verified: false,
    message: 'UID 与 API Token 已填写；官方 API 仅提供上传端点，将在实际发布时验证'
  }
}

export function defaultSiteAccount(site: PublishSite): SiteAccountConfig {
  return {
    enabled: site === 'anibt',
    apiKey: '',
    apiUrl: site === 'acgrip' ? 'https://acg.rip/api/post' : '',
    apiToken: '',
    uid: '',
    username: '',
    password: '',
    cookies: [],
    userAgent: '',
    identityName: '',
    anonymous: false,
    publishAsTeam: false,
    subtitleGroupId: null,
    subtitleGroupName: '',
    publishGroupId: null,
    publishGroupName: '',
    slug: '',
    scopes: [],
    status: '',
    lastCheckedAt: null
  }
}

/** ACG.RIP 的 Rails 表单勾选“以联盟身份发布”时只发送值 1；未勾选则不发送该字段。 */
export function acgripPostAsTeamValue(account: SiteAccountConfig): '1' | null {
  return account.publishAsTeam ? '1' : null
}

export function defaultSiteAccounts(): SiteAccounts {
  return Object.fromEntries(PUBLISH_SITES.map((site) => [site, defaultSiteAccount(site)])) as SiteAccounts
}

export function enabledSites(group: GroupAccount): PublishSite[] {
  return PUBLISH_SITES.filter((site) => group.sites[site].enabled)
}

export function isSiteConfigured(site: PublishSite, account: SiteAccountConfig): boolean {
  if (site === 'anibt') return account.apiKey.trim().length > 0
  if (site === 'mikan') return account.apiToken.trim().length > 0
  if (site === 'nyaa') return account.username.trim().length > 0 && account.password.length > 0
  if (site === 'acgrip') return account.apiUrl.trim().length > 0 && normalizeAcgripToken(account.apiToken).length > 0
  if (site === 'acgnxAsia' || site === 'acgnxGlobal') {
    return account.uid.trim().length > 0 && account.apiToken.trim().length > 0
  }
  return account.cookies.length > 0
}

/** 返回账号配置中第一个缺失项；空串表示具备执行站点检查/发布所需的最低配置。 */
export function siteConfigurationError(site: PublishSite, account: SiteAccountConfig): string {
  if (site === 'anibt') return account.apiKey.trim() ? '' : '请先填写 API Key'
  if (site === 'mikan') return account.apiToken.trim() ? '' : '请先填写 API Token'
  if (site === 'nyaa') {
    const hasCredentials = account.username.trim().length > 0 && account.password.length > 0
    return hasCredentials ? '' : '请先填写用户名和密码'
  }
  if (site === 'acgrip') {
    if (!account.apiUrl.trim()) return '请先填写 API URL'
    return normalizeAcgripToken(account.apiToken) ? '' : '请先填写 API Token'
  }
  if (site === 'acgnxAsia' || site === 'acgnxGlobal') {
    if (!account.uid.trim()) return '请先填写 UID'
    return account.apiToken.trim() ? '' : '请先填写 API Token'
  }
  return account.cookies.length > 0 ? '' : '请先完成网页登录并保存 Cookie'
}
