import { dialog, ipcMain, shell, BrowserWindow } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  AppData,
  AnibtWebAccount,
  IpcChannels,
  LocalPublishPayload,
  DashboardBounds,
  MikanSearchKind,
  ProxySettings,
  PublishPayload,
  PublishSite,
  SiteAccountConfig
} from '../shared/types.ts'
import { ConfigStore } from './store.ts'
import { changeConfigDir, getConfigDir } from './paths.ts'
import { addTorrent, removeTorrent } from './torrents.ts'
import * as anibt from './anibt.ts'
import { applyProxy } from './proxy.ts'
import { checkSite, publishLocal, removeArchive, searchMikan, testSiteConnection } from './local-publish.ts'
import { clearSiteCookies, getDmhyCaptcha, loginSiteAccount, openSiteLogin } from './site-login.ts'
import {
  initAnibtWeb, mergeLiveAnibtWebSession, loginAnibtWeb, checkAnibtWebLogin, logoutAnibtWeb,
  openAnibtDashboard, closeAnibtDashboard, updateAnibtDashboardBounds, updateAnibtDashboardTheme, setAnibtDashboardVisible, reloadAnibtDashboard, updateAnibtWebLocale,
  showDashboardMenu, hideDashboardMenu, updateDashboardMenu, dashboardMenuPainted, dashboardMenuAction,
  cancelAnibtWebLogin, updateAnibtWebLoginBounds, dashboardMenuHidden
} from './anibt-web.ts'

/**
 * IPC 注册。新增通道的固定动作：
 * ① 在 src/shared/types.ts 的 IpcChannels 写签名
 * ② 在这里补 handler
 * ③ 在 preload 暴露一行方法
 */
export function registerIpc(store: ConfigStore): void {
  initAnibtWeb(store)
  // 允许 handler 同步返回（IpcChannels 里声明的 Promise 由 ipcMain 自动包装）
  type HandlerReturn<K extends keyof IpcChannels> =
    ReturnType<IpcChannels[K]> extends Promise<infer R> ? R | Promise<R> : ReturnType<IpcChannels[K]>

  const handle = <K extends keyof IpcChannels>(
    channel: K,
    fn: (...args: Parameters<IpcChannels[K]>) => HandlerReturn<K>
  ): void => {
    ipcMain.handle(channel, (_event, ...args) => fn(...(args as Parameters<IpcChannels[K]>)))
  }

  // ---------- 存储 ----------
  // Cookie refresh is asynchronous. Serialize saves and relocation so an older
  // autosave cannot finish after the explicitly supplied migration snapshot.
  let writes: Promise<unknown> = Promise.resolve()
  function write<T>(action: () => Promise<T>): Promise<T> {
    const result = writes.then(action)
    writes = result.catch(() => undefined)
    return result
  }
  let selectedDirectory: string | null = null
  handle('store:load', () => store.load())
  handle('store:save', (data: AppData) => write(async () => {
    await mergeLiveAnibtWebSession(data)
    store.save(data)
    // 保存后立即应用代理设置
    void applyProxy(data.settings.proxy)
  }))
  handle('store:getDir', () => getConfigDir())
  ipcMain.handle('store:pickDir', async event => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    const picked = await dialog.showOpenDialog(win, { defaultPath: getConfigDir(), properties: ['openDirectory', 'createDirectory'] })
    selectedDirectory = picked.canceled ? null : (picked.filePaths[0] ?? null)
    return selectedDirectory
  })
  handle('store:changeDir', (directory: string, data: AppData) => write(async () => {
    if (!selectedDirectory || directory !== selectedDirectory) throw new Error('Please select a data directory first')
    selectedDirectory = null
    await mergeLiveAnibtWebSession(data)
    store.save(data)
    return changeConfigDir(directory)
  }))
  let fontCache: string[] | undefined
  ipcMain.handle('system:listFonts', async event => {
    if (fontCache) return fontCache
    // Chromium enumerates installed fonts on all three platforms; only load on demand.
    const fonts: string[] = await event.sender.executeJavaScript(
      'window.queryLocalFonts().then(fonts => [...new Set(fonts.map(font => font.family))].sort((a,b) => a.localeCompare(b)))', true)
    fontCache = fonts
    return fonts
  })
  handle('store:openDir', async () => {
    const dir = getConfigDir()
    await fs.mkdir(dir, { recursive: true })
    await shell.openPath(dir)
    return dir
  })

  // ---------- 窗口 ----------
  handle('window:minimize', () => {
    BrowserWindow.getFocusedWindow()?.minimize()
  })
  handle('window:toggleMaximize', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  handle('window:close', () => {
    BrowserWindow.getFocusedWindow()?.close()
  })

  // ---------- 种子 ----------
  handle('dialog:pickTorrents', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return []
    const result = await dialog.showOpenDialog(win, {
      title: '选择种子文件',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Torrent', extensions: ['torrent'] }]
    })
    if (result.canceled) return []
    const metas = []
    for (const filePath of result.filePaths) {
      try {
        const bytes = new Uint8Array(await fs.readFile(filePath))
        metas.push(addTorrent(path.basename(filePath), bytes))
      } catch (err) {
        console.error(`解析种子失败 ${filePath}:`, err)
      }
    }
    return metas
  })
  handle('torrent:addBytes', (fileName: string, bytes: Uint8Array) => addTorrent(fileName, bytes))
  handle('torrent:remove', (token: string) => {
    removeTorrent(token)
  })

  // ---------- AniBT API ----------
  handle('anibt:whoami', (apiKey: string) => anibt.whoami(apiKey))
  handle('anibt:groupMe', (apiKey: string) => anibt.groupMe(apiKey))
  handle('anibt:bgmSearch', (q: string, limit?: number) => anibt.bgmSearch(q, limit))
  handle('anibt:bgmDetails', (bgmId: number) => anibt.bgmDetails(bgmId))
  handle('anibt:publish', (payload: PublishPayload) => anibt.publishRelease(payload))
  handle('anibt:deleteRelease', (apiKey: string, releaseId: string) => anibt.deleteRelease(apiKey, releaseId))
  handle('anibt:deletionStatus', (apiKey: string, releaseId: string) => anibt.deletionStatus(apiKey, releaseId))
  ipcMain.handle('anibt:openDashboard', (event, bounds: DashboardBounds, mode: 'light' | 'dark') => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    if (!parent) throw new Error('Main window unavailable')
    return openAnibtDashboard(parent, bounds, mode)
  })
  ipcMain.handle('anibt:webLogin', (event, account: AnibtWebAccount, mode: 'light' | 'dark', bounds: DashboardBounds) => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    if (!parent) throw new Error('Main window unavailable')
    return loginAnibtWeb(parent, account, mode, bounds)
  })
  handle('anibt:cancelWebLogin', () => cancelAnibtWebLogin())
  handle('anibt:setWebLoginBounds', (bounds: DashboardBounds) => updateAnibtWebLoginBounds(bounds))
  handle('anibt:webCheck', () => checkAnibtWebLogin())
  handle('anibt:webLogout', (clearAll: boolean) => logoutAnibtWeb(clearAll))
  handle('anibt:setDashboardBounds', (bounds: DashboardBounds) => updateAnibtDashboardBounds(bounds))
  handle('anibt:setDashboardVisible', (visible: boolean) => setAnibtDashboardVisible(visible))
  ipcMain.handle('anibt:showDashboardMenu', (event, ...args: Parameters<IpcChannels['anibt:showDashboardMenu']>) => showDashboardMenu(event.sender, ...args))
  ipcMain.handle('anibt:hideDashboardMenu', (event, ...args: Parameters<IpcChannels['anibt:hideDashboardMenu']>) => hideDashboardMenu(event.sender, ...args))
  ipcMain.handle('anibt:updateDashboardMenu', (event, ...args: Parameters<IpcChannels['anibt:updateDashboardMenu']>) => updateDashboardMenu(event.sender, ...args))
  ipcMain.handle('anibt:dashboardMenuPainted', (event, ...args: Parameters<IpcChannels['anibt:dashboardMenuPainted']>) => dashboardMenuPainted(event.sender, ...args))
  ipcMain.handle('anibt:dashboardMenuHidden', (event, id: string) => dashboardMenuHidden(event.sender, id))
  ipcMain.handle('anibt:dashboardMenuAction', (event, ...args: Parameters<IpcChannels['anibt:dashboardMenuAction']>) => dashboardMenuAction(event.sender, ...args))
  handle('anibt:reloadDashboard', () => reloadAnibtDashboard())
  handle('anibt:setWebLocale', (locale: 'zh-CN' | 'zh-TW' | 'en') => updateAnibtWebLocale(locale))
  handle('anibt:setDashboardTheme', (themeMode: 'light' | 'dark') => updateAnibtDashboardTheme(themeMode))
  handle('anibt:closeDashboard', () => closeAnibtDashboard())

  // ---------- 备用本地直发 / 站点登录 ----------
  handle('local:publish', (payload: LocalPublishPayload) => publishLocal(payload, store.load()))
  handle('local:removeArchive', (recordId: string) => removeArchive(recordId))
  handle('site:login', (groupId: string, site: PublishSite, account: SiteAccountConfig, captchaCode: string) =>
    loginSiteAccount(groupId, site, account, captchaCode)
  )
  handle('site:openLogin', (groupId: string, site: PublishSite, account: SiteAccountConfig) =>
    openSiteLogin(BrowserWindow.getFocusedWindow(), groupId, site, account)
  )
  handle('site:dmhyCaptcha', (groupId: string, account: SiteAccountConfig) => getDmhyCaptcha(groupId, account))
  handle('site:clearCookies', (groupId: string, site: PublishSite) => clearSiteCookies(groupId, site))
  handle('site:check', (site: PublishSite, account: SiteAccountConfig) => checkSite(site, account))
  handle('mikan:search', (kind: MikanSearchKind, query: string) => searchMikan(kind, query))

  // ---------- 代理 / 繁化姬 ----------
  handle('proxy:apply', (proxy: ProxySettings) => applyProxy(proxy))
  handle('proxy:testSite', (site: PublishSite) => testSiteConnection(site))
  handle('zhconvert:traditional', (text: string) => anibt.zhconvertTraditional(text))
}
