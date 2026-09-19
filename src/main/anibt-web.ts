import { BrowserWindow, WebContentsView, session, shell, type Session, type WebContents } from 'electron'
import type { AnibtWebAccount, AppData, DashboardBounds, Locale, SiteLoginResult, ThemeMode } from '../shared/types.ts'
import { ANIBT_WEB_ORIGIN, anibtChallengeScript, anibtLoginScript, anibtThemeScript, hasAnibtWebSession, isAnibtWebUrl } from '../shared/anibt-web.ts'
import { applyProxyToSession, getProxy } from './proxy.ts'
import type { ConfigStore } from './store.ts'
import { DashboardMenuHost } from './dashboard-menu.ts'
import type { DashboardMenuAction, DashboardMenuRequest, DashboardMenuSettings } from '../shared/dashboard-menu.ts'

const PARTITION = 'persist:abp-anibt-web'
const DASHBOARD_CACHE_MS = 15 * 60 * 1000
let store: ConfigStore
let sessionPromise: Promise<Session> | undefined
let activeSession: Session | undefined
let loginView: { parent: BrowserWindow; view: WebContentsView; cancel: () => void } | null = null
let loginGeneration = 0
let loginPromise: Promise<SiteLoginResult> | null = null
let theme: ThemeMode = 'light'
let webLocale: Locale = 'zh-CN'
let generation = 0
let dashboard: { parent: BrowserWindow; view: WebContentsView; closed: () => void; load: Promise<void> } | null = null
let dashboardHideTimer: ReturnType<typeof setTimeout> | undefined
let dashboardPageVisible = false
let dashboardMenu: DashboardMenuHost | null = null
let localeUpdate: Promise<void> = Promise.resolve()

export function initAnibtWeb(config: ConfigStore): void {
  store = config
  webLocale = config.load().settings.locale
}

async function cookies(ses: Session): Promise<AnibtWebAccount['cookies']> {
  return (await ses.cookies.get({})).filter(c => {
    const host = c.domain?.replace(/^\./, '')
    return host === 'anibt.net' || host?.endsWith('.anibt.net')
  }).map(c => ({
    name: c.name, value: c.value, domain: c.domain ?? 'anibt.net', path: c.path ?? '/',
    secure: c.secure ?? false, httpOnly: c.httpOnly ?? false, expirationDate: c.expirationDate, sameSite: c.sameSite
  }))
}

function webLocaleValue(locale: Locale): 'zh' | 'zh-Hant' | 'en' {
  return locale === 'zh-TW' ? 'zh-Hant' : locale === 'en' ? 'en' : 'zh'
}

async function setWebLocaleCookie(ses: Session, locale: Locale): Promise<void> {
  const existing = await ses.cookies.get({ name: 'PARAGLIDE_LOCALE' })
  if (existing.length === 1 && existing[0].hostOnly && existing[0].path === '/' && existing[0].value === webLocaleValue(locale)) return
  // AniBT sets a host-only cookie. Remove old domain-scoped copies before replacing
  // it, otherwise document.cookie can contain two contradictory locale values.
  if (existing.length) await ses.cookies.remove(ANIBT_WEB_ORIGIN, 'PARAGLIDE_LOCALE')
  await ses.cookies.set({
    url: ANIBT_WEB_ORIGIN,
    path: '/',
    name: 'PARAGLIDE_LOCALE',
    value: webLocaleValue(locale),
    expirationDate: Math.floor(Date.now() / 1000) + 400 * 24 * 60 * 60,
    secure: true,
    httpOnly: false,
    sameSite: 'lax'
  })
}

async function persistCookies(ses: Session): Promise<void> {
  const saved = await cookies(ses)
  const data = store.load()
  data.anibtWebAccount.cookies = saved
  data.anibtWebAccount.userAgent = ses.getUserAgent()
  store.save(data)
}

async function webSession(): Promise<Session> {
  if (!sessionPromise) sessionPromise = (async () => {
    const ses = session.fromPartition(PARTITION)
    const saved = store.load().anibtWebAccount
    // Seed only once. Re-seeding on each open would resurrect cookies removed by logout.
    // The locale cookie is always present, so exclude it when deciding whether the
    // persisted authentication cookies still need to be restored.
    const liveCookies = await cookies(ses)
    if (!liveCookies.some(cookie => cookie.name !== 'PARAGLIDE_LOCALE')) {
      for (const c of saved.cookies) {
        const host = c.domain.replace(/^\./, '')
        if (host !== 'anibt.net' && !host.endsWith('.anibt.net')) continue
        if (c.expirationDate && c.expirationDate <= Date.now() / 1000) continue
        try { await ses.cookies.set({ ...c, url: `https://${host}${c.path || '/'}` }) } catch { /* Stale imported cookie. */ }
      }
    }
    await setWebLocaleCookie(ses, webLocale)
    const proxy = getProxy()
    if (proxy) await applyProxyToSession(ses, proxy)
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    ses.setPermissionCheckHandler(() => false)
    let timer: ReturnType<typeof setTimeout> | undefined
    ses.cookies.on('changed', () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { void persistCookies(ses).catch(() => undefined) }, 100)
    })
    activeSession = ses
    return ses
  })().catch(error => { sessionPromise = undefined; throw error })
  const ses = await sessionPromise
  await setWebLocaleCookie(ses, webLocale)
  const proxy = getProxy()
  if (proxy) await applyProxyToSession(ses, proxy)
  return ses
}

/** Cookie state is owned by Chromium, never overwritten by an older renderer autosave. */
export async function mergeLiveAnibtWebSession(data: AppData): Promise<void> {
  if (activeSession) {
    data.anibtWebAccount.cookies = await cookies(activeSession)
    data.anibtWebAccount.userAgent = activeSession.getUserAgent()
  }
}

async function applyTheme(wc: WebContents): Promise<void> {
  if (!wc.isDestroyed() && isAnibtWebUrl(wc.getURL())) await wc.executeJavaScript(anibtThemeScript(theme))
}

export async function updateAnibtDashboardTheme(mode: ThemeMode): Promise<void> {
  theme = mode === 'dark' ? 'dark' : 'light'
  const background = theme === 'dark' ? '#17101a' : '#fffbfc'
  dashboard?.view.setBackgroundColor(background)
  loginView?.view.setBackgroundColor(background)
  await Promise.all([dashboard?.view.webContents, loginView?.view.webContents].filter((wc): wc is WebContents => !!wc)
    .map(wc => applyTheme(wc).catch(() => undefined)))
}

export async function showDashboardMenu(sender: WebContents, request: DashboardMenuRequest): Promise<boolean> {
  if (!dashboard || !dashboardPageVisible || sender !== dashboard.parent.webContents) return false
  dashboardMenu ??= new DashboardMenuHost(dashboard.parent, dashboard.view.webContents)
  return dashboardMenu.show(request)
}

export function hideDashboardMenu(sender: WebContents, id?: string): void {
  if (sender === dashboard?.parent.webContents) dashboardMenu?.hide(id)
}

export function updateDashboardMenu(sender: WebContents, settings: DashboardMenuSettings): void {
  if (sender === dashboard?.parent.webContents) dashboardMenu?.updateSettings(settings)
}

export function dashboardMenuPainted(sender: WebContents, id: string, size: { width: number; height: number }): void {
  dashboardMenu?.painted(sender, id, size)
}

export function dashboardMenuAction(sender: WebContents, id: string, action: DashboardMenuAction): void {
  dashboardMenu?.action(sender, id, action)
}

export function dashboardMenuHidden(sender: WebContents, id: string): void {
  dashboardMenu?.hidden(sender, id)
}

function securePage(wc: WebContents): void {
  wc.on('will-navigate', (event, url) => { if (!isAnibtWebUrl(url)) event.preventDefault() })
  wc.on('will-redirect', (event, url) => { if (!isAnibtWebUrl(url)) event.preventDefault() })
  wc.setWindowOpenHandler(({ url }) => {
    if (isAnibtWebUrl(url)) void wc.loadURL(url).catch(() => undefined)
    else if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  wc.on('dom-ready', () => { void applyTheme(wc).catch(() => undefined) })
  wc.on('did-navigate-in-page', () => { void applyTheme(wc).catch(() => undefined) })
  wc.on('did-finish-load', () => { void applyTheme(wc).catch(() => undefined) })
}

export async function checkAnibtWebLogin(): Promise<SiteLoginResult> {
  const ses = await webSession()
  let ok = false
  let message = '尚未登录。请点击登录，并在账号页完成“我是人类”验证。'
  try {
    // Electron net.fetch throws "Redirect was cancelled" for redirect:manual.
    // Better Auth's read-only session endpoint returns null for anonymous users.
    const response = await ses.fetch(`${ANIBT_WEB_ORIGIN}/api/auth/get-session`, {
      cache: 'no-store', credentials: 'include', signal: AbortSignal.timeout(15000)
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    ok = hasAnibtWebSession(await response.json())
    if (ok) message = 'AniBT 网页已登录'
  } catch (error) {
    message = `无法确认 AniBT 登录状态，请重试：${String(error)}`
  }
  await persistCookies(ses)
  return { ok, message, cookies: await cookies(ses), userAgent: ses.getUserAgent() }
}

export function cancelAnibtWebLogin(): void {
  loginGeneration++
  loginView?.cancel()
}

export function updateAnibtWebLoginBounds(bounds: DashboardBounds): void {
  if (!loginView) return
  if (!Object.values(bounds).every(Number.isFinite)) throw new Error('Invalid login bounds')
  const [width, height] = loginView.parent.getContentSize()
  const x = Math.max(0, Math.min(width, Math.round(bounds.x)))
  const y = Math.max(44, Math.min(height, Math.round(bounds.y)))
  loginView.view.setBounds({ x, y, width: Math.max(0, Math.min(width - x, Math.round(bounds.width))),
    height: Math.max(0, Math.min(height - y, Math.round(bounds.height))) })
}

export async function loginAnibtWeb(parent: BrowserWindow, account: AnibtWebAccount, mode: ThemeMode, bounds: DashboardBounds): Promise<SiteLoginResult> {
  if (loginPromise) return loginPromise
  if (!bounds || !Object.values(bounds).every(Number.isFinite)) throw new Error('Invalid login bounds')
  if (!account.username.trim() || !account.password) return { ok: false, message: '请先填写邮箱和密码', cookies: [], userAgent: '' }
  theme = mode
  const request = ++loginGeneration
  loginPromise = (async () => {
    const ses = await webSession()
    const existing = await checkAnibtWebLogin()
    const cancelled = { ...existing, ok: false, message: '已取消登录，尚未完成登录验证' }
    if (request !== loginGeneration || parent.isDestroyed()) return cancelled
    // Authenticated users are redirected away from sign-in by AniBT. Do not load
    // that route again, or let its navigation cancellation overwrite a valid session.
    if (existing.ok) {
      if (dashboard?.view.webContents.getURL().startsWith(`${ANIBT_WEB_ORIGIN}/auth/`)) await reloadAnibtDashboard().catch(() => undefined)
      return existing
    }
    const data = store.load()
    data.anibtWebAccount.username = account.username
    data.anibtWebAccount.password = account.password
    store.save(data)
    const view = new WebContentsView({ webPreferences: {
      session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false
    } })
    const wc = view.webContents
    securePage(wc)
    view.setBackgroundColor(mode === 'dark' ? '#17101a' : '#fffbfc')
    view.setVisible(false)
    parent.contentView.addChildView(view)
    return new Promise<SiteLoginResult>(resolve => {
      let settled = false
      let checking = false
      let ready = false
      let layoutHeight = 0
      const finish = (result: SiteLoginResult): void => {
        if (settled) return
        settled = true
        clearInterval(poll)
        clearTimeout(timeout)
        parent.removeListener('closed', cancel)
        if (loginView?.view === view) loginView = null
        if (!parent.isDestroyed()) parent.contentView.removeChildView(view)
        if (!wc.isDestroyed()) wc.close()
        if (result.ok) void reloadAnibtDashboard().catch(() => undefined)
        resolve(result)
      }
      const cancel = (): void => finish(cancelled)
      const verify = async (errorMessage?: string): Promise<void> => {
        try {
          const result = await checkAnibtWebLogin()
          if (result.ok || errorMessage) finish(result.ok ? result : { ...result, message: errorMessage })
        } catch {
          finish({ ...cancelled, message: errorMessage || '登录状态读取失败，请重新检查' })
        }
      }
      const prepare = async (): Promise<void> => {
        if (settled || checking || !isAnibtWebUrl(wc.getURL())) return
        checking = true
        try {
          if (new URL(wc.getURL()).pathname !== '/auth/sign-in') {
            await verify()
            return
          }
          if (!ready) await wc.executeJavaScript(anibtLoginScript(account.username.trim(), account.password))
          const height = await wc.executeJavaScript(anibtChallengeScript())
          if (typeof height === 'number' && Number.isFinite(height) && height > 0 && !settled) {
            const nextHeight = Math.max(88, Math.min(320, height))
            if (layoutHeight !== nextHeight) {
              layoutHeight = nextHeight
              parent.webContents.send('anibt:webLoginHeight', nextHeight)
            }
            ready = true
            clearTimeout(timeout)
            if (!parent.contentView.children.includes(view)) parent.contentView.addChildView(view)
            if (!view.getVisible()) view.setVisible(true)
          }
        } catch { /* A navigation can replace the document between these calls. */ }
        finally { checking = false }
      }
      const poll = setInterval(() => { void prepare() }, 200)
      const timeout = setTimeout(() => { void verify('无法加载 AniBT 人机验证，请检查网络后重试') }, 30000)
      loginView = { parent, view, cancel }
      updateAnibtWebLoginBounds(bounds)
      parent.once('closed', cancel)
      wc.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
        if (!isMainFrame || settled) return
        // Never flash the full login/dashboard page during a document navigation.
        parent.contentView.removeChildView(view)
        view.setVisible(false)
        ready = false
      })
      wc.on('dom-ready', () => { ready = false; void prepare() })
      wc.on('did-navigate-in-page', () => { void prepare() })
      wc.on('did-finish-load', () => { void prepare() })
      void wc.loadURL(`${ANIBT_WEB_ORIGIN}/auth/sign-in?redirectTo=%2Fgroups`).catch((error: Error) => {
        if (!settled) void verify(`AniBT 登录页面加载失败：${error.message}`)
      })
    })
  })()
  try { return await loginPromise } finally { loginPromise = null }
}

export function closeAnibtDashboard(): void {
  generation++
  dashboardMenu?.dispose()
  dashboardMenu = null
  if (dashboardHideTimer) clearTimeout(dashboardHideTimer)
  dashboardHideTimer = undefined
  dashboardPageVisible = false
  const old = dashboard
  dashboard = null
  if (!old) return
  old.parent.removeListener('closed', old.closed)
  if (!old.parent.isDestroyed()) old.parent.contentView.removeChildView(old.view)
  if (!old.view.webContents.isDestroyed()) old.view.webContents.close()
}

export function updateAnibtDashboardBounds(bounds: DashboardBounds): void {
  if (!dashboard) return
  if (!Object.values(bounds).every(Number.isFinite)) throw new Error('Invalid dashboard bounds')
  const [width, height] = dashboard.parent.getContentSize()
  const x = Math.min(width, Math.max(0, Math.round(bounds.x)))
  const y = Math.min(height, Math.max(0, Math.round(bounds.y)))
  dashboard.view.setBounds({ x, y, width: Math.max(0, Math.min(width - x, Math.round(bounds.width))),
    height: Math.max(0, Math.min(height - y, Math.round(bounds.height))) })
}

export function setAnibtDashboardVisible(visible: boolean): void {
  dashboardPageVisible = visible
  if (!dashboard) return
  if (dashboardHideTimer) clearTimeout(dashboardHideTimer)
  dashboardHideTimer = undefined
  // Chromium can throttle an unfocused embedded page when the menu takes focus.
  // Keep the visible dashboard live; restore throttling when it is only cached.
  dashboard.view.webContents.setBackgroundThrottling(!visible)
  dashboard.view.setVisible(visible)
  if (!visible) {
    dashboardMenu?.dispose()
    dashboardMenu = null
    dashboardHideTimer = setTimeout(() => {
      dashboardHideTimer = undefined
      closeAnibtDashboard()
    }, DASHBOARD_CACHE_MS)
    dashboardHideTimer.unref?.()
  }
}

export async function updateAnibtWebLocale(locale: Locale): Promise<void> {
  if (!['zh-CN', 'zh-TW', 'en'].includes(locale)) throw new Error('Invalid locale')
  const changed = locale !== webLocale
  webLocale = locale
  if (!activeSession) return
  localeUpdate = localeUpdate.catch(() => undefined).then(async () => {
    if (locale !== webLocale || !activeSession) return
    await setWebLocaleCookie(activeSession, locale)
    if (!changed || locale !== webLocale) return
    for (const wc of [dashboard?.view.webContents, loginView?.view.webContents]) {
      if (wc && !wc.isDestroyed()) wc.reload()
    }
  })
  await localeUpdate
}

export async function reloadAnibtDashboard(): Promise<void> {
  if (!dashboard || dashboard.view.webContents.isDestroyed()) return
  const wc = dashboard.view.webContents
  // An anonymous dashboard may have redirected to sign-in. Reloading that URL
  // after authentication just repeats its redirect/error; reopen the intended route.
  if (wc.getURL().startsWith(`${ANIBT_WEB_ORIGIN}/auth/`)) await wc.loadURL(`${ANIBT_WEB_ORIGIN}/groups`)
  else wc.reload()
  await applyTheme(wc)
}

export async function openAnibtDashboard(parent: BrowserWindow, bounds: DashboardBounds, mode: ThemeMode): Promise<void> {
  if (dashboard && dashboard.parent === parent && !dashboard.view.webContents.isDestroyed()) {
    if (dashboardHideTimer) clearTimeout(dashboardHideTimer)
    dashboardHideTimer = undefined
    theme = mode
    dashboardPageVisible = true
    dashboard.view.setBackgroundColor(mode === 'dark' ? '#17101a' : '#fffbfc')
    updateAnibtDashboardBounds(bounds)
    await dashboard.load
    await applyTheme(dashboard.view.webContents)
    dashboard.view.setVisible(dashboardPageVisible)
    return
  }
  closeAnibtDashboard()
  dashboardPageVisible = true
  const request = generation
  theme = mode
  const ses = await webSession()
  if (request !== generation || parent.isDestroyed()) return
  const view = new WebContentsView({ webPreferences: {
    session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false
  } })
  let resolveLoad!: () => void
  let rejectLoad!: (error: unknown) => void
  const load = new Promise<void>((resolve, reject) => { resolveLoad = resolve; rejectLoad = reject })
  dashboard = { parent, view, closed: closeAnibtDashboard, load }
  parent.once('closed', closeAnibtDashboard)
  view.setBackgroundColor(mode === 'dark' ? '#17101a' : '#fffbfc')
  view.setVisible(false)
  parent.contentView.addChildView(view)
  // Prewarm only while the dashboard is in use; disposed on route leave.
  dashboardMenu = new DashboardMenuHost(parent, view.webContents)
  updateAnibtDashboardBounds(bounds)
  securePage(view.webContents)
  try {
    await view.webContents.loadURL(`${ANIBT_WEB_ORIGIN}/groups`)
    await applyTheme(view.webContents)
    resolveLoad()
  } catch (error) {
    rejectLoad(error)
    if (request !== generation) return // route switched while loading
    closeAnibtDashboard()
    throw error
  }
}

export async function logoutAnibtWeb(clearAll: boolean): Promise<void> {
  const ses = await webSession()
  if (loginPromise) throw new Error('请先取消正在进行的登录')
  closeAnibtDashboard()
  if (!clearAll) {
    // Better Auth sign-out endpoint, as used by AniBT's web auth client.
    const response = await ses.fetch(`${ANIBT_WEB_ORIGIN}/api/auth/sign-out`, {
      method: 'POST', credentials: 'include', headers: { Origin: ANIBT_WEB_ORIGIN, 'Content-Type': 'application/json' },
      body: '{}', signal: AbortSignal.timeout(15000)
    })
    if (!response.ok) throw new Error(`退出失败（HTTP ${response.status}），可使用清除 Cookie 在本机退出`)
  }
  await ses.clearStorageData({ storages: clearAll ? ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] : ['cookies'] })
  if (clearAll) await ses.clearCache()
  await persistCookies(ses)
}
