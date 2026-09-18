import { createHash } from 'node:crypto'
import { BrowserWindow, session, type Session } from 'electron'
import { accountPartition, LOGIN_URLS } from './local-publish.ts'
import type {
  PublishSite,
  SiteAccountConfig,
  SiteCaptchaResult,
  SiteLoginResult,
  StoredSiteCookie
} from '../shared/types.ts'
import { evaluateDmhyLoginResponse } from '../shared/sites.ts'
import { applyProxyToSession, getProxy } from './proxy.ts'

const SITE_COOKIE_DOMAINS: Partial<Record<PublishSite, string[]>> = {
  dmhy: ['dmhy.org'],
  bangumiMoe: ['bangumi.moe']
}

function toStored(cookie: Electron.Cookie): StoredSiteCookie {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain ?? '',
    path: cookie.path ?? '/',
    secure: cookie.secure === true,
    httpOnly: cookie.httpOnly === true,
    expirationDate: cookie.expirationDate,
    sameSite: cookie.sameSite
  }
}

function fillScript(site: PublishSite, account: SiteAccountConfig): string {
  const username = JSON.stringify(account.username)
  const password = JSON.stringify(account.password)
  const selectors: Partial<Record<PublishSite, { user: string; pass: string }>> = {
    dmhy: { user: 'input[name=email]', pass: 'input[name=password]' },
    bangumiMoe: { user: 'input[name=username],input[type=email]', pass: 'input[name=password],input[type=password]' }
  }
  const pair = selectors[site]
  if (!pair) return ''
  return `(()=>{const set=(s,v)=>{const e=document.querySelector(s);if(!e||!v)return;e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))};set(${JSON.stringify(pair.user)},${username});set(${JSON.stringify(pair.pass)},${password})})()`
}

function belongsToSite(site: PublishSite, domain: string): boolean {
  const normalized = domain.replace(/^\./, '').toLowerCase()
  return (SITE_COOKIE_DOMAINS[site] ?? []).some((suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`))
}

async function seedCookies(ses: Session, account: SiteAccountConfig): Promise<void> {
  for (const cookie of account.cookies) {
    if (!cookie.name || !cookie.domain) continue
    try {
      await ses.cookies.set({
        url: `${cookie.secure ? 'https' : 'http'}://${cookie.domain.replace(/^\./, '')}${cookie.path || '/'}`,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path || '/',
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        expirationDate: cookie.expirationDate,
        sameSite: cookie.sameSite
      })
    } catch {
      // Ignore stale imported cookies; a successful login will replace them.
    }
  }
}

async function getAccountSession(groupId: string, account: SiteAccountConfig, seedStoredCookies = true): Promise<Session> {
  const ses = session.fromPartition(accountPartition(groupId))
  const proxy = getProxy()
  if (proxy) await applyProxyToSession(ses, proxy)
  if (seedStoredCookies) await seedCookies(ses, account)
  return ses
}

async function captureResult(
  ses: Session,
  site: PublishSite,
  account: SiteAccountConfig,
  ok: boolean,
  message?: string
): Promise<SiteLoginResult> {
  const cookies = (await ses.cookies.get({}))
    .filter((cookie) => belongsToSite(site, cookie.domain ?? ''))
    .map(toStored)
  return { ok, cookies, userAgent: account.userAgent || ses.getUserAgent(), message }
}

async function verifySiteLogin(ses: Session, site: PublishSite): Promise<{ ok: boolean; message?: string }> {
  try {
    if (site === 'bangumiMoe') {
      const response = await ses.fetch('https://bangumi.moe/api/team/myteam')
      const raw = await response.text()
      let teams: unknown = null
      try {
        teams = JSON.parse(raw)
      } catch {
        // The failure message below is clearer than a JSON parser error.
      }
      return Array.isArray(teams) && teams.length > 0
        ? { ok: true }
        : { ok: false, message: '未检测到可发布的萌番组团队，请确认账号已登录并加入团队' }
    }
    if (site === 'dmhy') {
      const response = await ses.fetch('https://www.dmhy.org/user', { redirect: 'manual' })
      return response.status === 200
        ? { ok: true }
        : { ok: false, message: '未检测到动漫花园登录状态' }
    }
    return { ok: false, message: '该站点不使用 Cookie 登录' }
  } catch (error) {
    return { ok: false, message: String(error) }
  }
}

/**
 * 打开隔离的真实登录窗口。验证码和 Cloudflare 由用户在站点页面完成；关闭窗口时
 * 抽取该账号 partition 的 Cookie 返回渲染层，再随其他凭据写入加密 secrets.json。
 */
export async function openSiteLogin(
  parent: BrowserWindow | null,
  groupId: string,
  site: PublishSite,
  account: SiteAccountConfig,
  autoFill = false
): Promise<SiteLoginResult> {
  const url = LOGIN_URLS[site]
  if (!url) return { ok: false, cookies: [], userAgent: account.userAgent, message: '该站点使用 API 凭据，无需网页登录' }
  const ses = await getAccountSession(groupId, account)
  const win = new BrowserWindow({
    parent: parent ?? undefined,
    modal: parent != null,
    width: 980,
    height: 760,
    minWidth: 720,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.webContents.setWindowOpenHandler(({ url: next }) => {
    void win.loadURL(next)
    return { action: 'deny' }
  })
  win.once('ready-to-show', () => win.show())
  win.webContents.on('dom-ready', () => {
    if (!autoFill) return
    const script = fillScript(site, account)
    if (script) void win.webContents.executeJavaScript(script).catch(() => undefined)
  })
  await win.loadURL(url)
  return new Promise((resolve) => {
    win.once('closed', () => {
      void (async () => {
        const verified = await verifySiteLogin(ses, site)
        resolve(await captureResult(ses, site, account, verified.ok, verified.message))
      })()
    })
  })
}

/** 获取动漫花园图片验证码。验证码和登录提交必须使用同一个账号组 Session。 */
export async function getDmhyCaptcha(groupId: string, account: SiteAccountConfig): Promise<SiteCaptchaResult> {
  try {
    const ses = await getAccountSession(groupId, account)
    const response = await ses.fetch(`https://www.dmhy.org/common/generate-captcha?code=${Date.now()}`, {
      headers: { 'User-Agent': account.userAgent || ses.getUserAgent() }
    })
    const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!response.ok || !contentType.startsWith('image/')) {
      const raw = await response.text()
      const message = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
      return { ok: false, message: message || `获取验证码失败（HTTP ${response.status}）` }
    }
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length === 0) return { ok: false, message: '动漫花园返回了空验证码图片' }
    return { ok: true, dataUrl: `data:${contentType};base64,${bytes.toString('base64')}` }
  } catch (error) {
    return { ok: false, message: String(error) }
  }
}

/** 使用账号密码登录；动漫花园验证码在应用内获取和提交。 */
export async function loginSiteAccount(
  groupId: string,
  site: PublishSite,
  account: SiteAccountConfig,
  captchaCode: string
): Promise<SiteLoginResult> {
  if (!account.username.trim() || !account.password) {
    return { ok: false, cookies: account.cookies, userAgent: account.userAgent, message: '请先填写账号和密码' }
  }
  if (site !== 'dmhy' && site !== 'bangumiMoe') {
    return { ok: false, cookies: account.cookies, userAgent: account.userAgent, message: '该站点不支持账号密码登录' }
  }

  // The CAPTCHA request has already installed its PHP session cookie. Re-seeding the
  // stored cookies here could overwrite it with a stale session and invalidate the code.
  const ses = await getAccountSession(groupId, account, site !== 'dmhy')
  if (site === 'dmhy') {
    if (!captchaCode.trim()) {
      return { ok: false, cookies: account.cookies, userAgent: account.userAgent, message: '请先获取并填写验证码' }
    }
    try {
      const form = new FormData()
      form.append('goto', 'https://www.dmhy.org/')
      form.append('email', account.username.trim())
      form.append('password', account.password)
      form.append('login_node', '0')
      form.append('cookietime', '315360000')
      form.append('captcha_code', captchaCode.trim())
      const response = await ses.fetch('https://www.dmhy.org/user/login', {
        method: 'POST',
        headers: { 'User-Agent': account.userAgent || ses.getUserAgent() },
        body: form
      })
      const result = evaluateDmhyLoginResponse(await response.text())
      if (!response.ok || !result.ok) {
        return captureResult(ses, site, account, false, result.message || `登录失败（HTTP ${response.status}）`)
      }
      return captureResult(ses, site, account, true, result.message)
    } catch (error) {
      return captureResult(ses, site, account, false, String(error))
    }
  }

  try {
    const response = await ses.fetch('https://bangumi.moe/api/user/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: account.username.trim(),
        password: createHash('md5').update(account.password).digest('hex')
      })
    })
    const raw = await response.text()
    let success = false
    let message = ''
    try {
      const result = JSON.parse(raw) as { success?: boolean; message?: string }
      success = response.ok && result.success === true
      message = result.message ?? ''
    } catch {
      message = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
    }
    if (!success) return captureResult(ses, site, account, false, message || `登录失败（HTTP ${response.status}）`)
    const verified = await verifySiteLogin(ses, site)
    return captureResult(ses, site, account, verified.ok, verified.message)
  } catch (error) {
    return captureResult(ses, site, account, false, String(error))
  }
}

export async function clearSiteCookies(groupId: string, site: PublishSite): Promise<void> {
  const ses = session.fromPartition(accountPartition(groupId))
  const cookies = await ses.cookies.get({})
  await Promise.all(
    cookies
      .filter((cookie) => belongsToSite(site, cookie.domain ?? ''))
      .map((cookie) => {
        const host = (cookie.domain ?? '').replace(/^\./, '')
        const url = `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path || '/'}`
        return ses.cookies.remove(url, cookie.name)
      })
  )
}
