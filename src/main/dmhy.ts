import { DMHY_ORIGINS, parseDmhyIdentities, selectDmhyIdentity } from '../shared/dmhy.ts'

type DmhyPublishContext =
  | { ok: true; url: string; teamId: string; identityName: string }
  | { ok: false; error: string }

/** GET only. Resolve a usable session/identity before making exactly one upload POST. */
export async function loadDmhyPublishContext(
  fetchPage: (url: string) => Promise<Response>,
  expected: string
): Promise<DmhyPublishContext> {
  const errors: string[] = []
  for (const origin of DMHY_ORIGINS) {
    try {
      const response = await fetchPage(`${origin}/topics/add`)
      const html = await response.text()
      const url = new URL(response.url || `${origin}/topics/add`)
      let error: string
      if (!(DMHY_ORIGINS as readonly string[]).includes(url.origin)) {
        error = '发布页跳转到未知站点，请重新登录'
      } else if (/\/user\/login\b/i.test(url.pathname) || /登入發佈系統|登录发布系统/.test(html)) {
        error = '登录已失效，请重新登录动漫花园'
      } else if (/cf-chl-|challenge-platform|<title>\s*Just a moment/i.test(html)) {
        error = '需要网页验证，请使用“打开网页登录”完成验证'
      } else if (!response.ok) {
        error = `加载发布页失败（HTTP ${response.status}）`
      } else {
        const identities = parseDmhyIdentities(html)
        const identity = selectDmhyIdentity(identities, expected)
        if (identity) {
          return { ok: true, url: `${url.origin}/topics/add`, teamId: identity.id, identityName: identity.name }
        }
        if (identities.length > 0) {
          // Never silently substitute another identity for an explicitly configured name.
          return { ok: false, error: `未找到动漫花园发布身份“${expected.trim()}”。当前账号可用身份：${identities.map((item) => item.name).join('、')}` }
        }
        error = '发布页没有可用的发布身份，请确认账号具备发布权限'
      }
      errors.push(`${url.hostname}：${error}`)
    } catch {
      errors.push(`${new URL(origin).hostname}：无法加载发布页，请检查网络或代理`)
    }
  }
  return { ok: false, error: errors.join('；') }
}
