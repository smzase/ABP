import { contextBridge, ipcRenderer } from 'electron'
import type { DashboardMenuEvent, DashboardMenuRequest, DashboardMenuSettings } from '../shared/dashboard-menu.ts'
import type { DashboardNavigationAction, DashboardNavigationState } from '../shared/dashboard-navigation.ts'
import type {
  AppData,
  AnibtWebAccount,
  DashboardBounds,
  IpcChannels,
  LocalPublishPayload,
  Locale,
  MikanSearchKind,
  ProxySettings,
  PublishPayload,
  PublishSite,
  SiteAccountConfig,
  ThemeMode
} from '../shared/types.ts'

/**
 * IPC 契约驱动：通道签名集中在 IpcChannels，这里自动推导类型。
 * 新增通道只需改 types.ts + main/ipc.ts + 下面加一行暴露。
 */
const invoke = <K extends keyof IpcChannels>(
  channel: K,
  ...args: Parameters<IpcChannels[K]>
): ReturnType<IpcChannels[K]> => ipcRenderer.invoke(channel, ...args) as ReturnType<IpcChannels[K]>

const api = {
  // 存储
  loadStore: (): Promise<AppData> => invoke('store:load'),
  saveStore: (data: AppData): Promise<void> => invoke('store:save', data),
  openConfigDir: (): Promise<string> => invoke('store:openDir'),
  getConfigDir: () => invoke('store:getDir'),
  pickConfigDir: () => invoke('store:pickDir'),
  changeConfigDir: (directory: string, data: AppData) => invoke('store:changeDir', directory, data),
  listFonts: () => invoke('system:listFonts'),

  // 窗口
  minimizeWindow: (): Promise<void> => invoke('window:minimize'),
  toggleMaximizeWindow: (): Promise<void> => invoke('window:toggleMaximize'),
  closeWindow: (): Promise<void> => invoke('window:close'),

  // 种子
  pickTorrents: () => invoke('dialog:pickTorrents'),
  addTorrentBytes: (fileName: string, bytes: Uint8Array) => invoke('torrent:addBytes', fileName, bytes),
  removeTorrent: (token: string) => invoke('torrent:remove', token),

  // AniBT API
  anibtWhoami: (apiKey: string) => invoke('anibt:whoami', apiKey),
  anibtGroupMe: (apiKey: string) => invoke('anibt:groupMe', apiKey),
  anibtBgmSearch: (q: string, limit?: number) => invoke('anibt:bgmSearch', q, limit),
  anibtBgmDetails: (bgmId: number) => invoke('anibt:bgmDetails', bgmId),
  anibtPublish: (payload: PublishPayload) => invoke('anibt:publish', payload),
  anibtDeleteRelease: (apiKey: string, releaseId: string) => invoke('anibt:deleteRelease', apiKey, releaseId),
  anibtDeletionStatus: (apiKey: string, releaseId: string) => invoke('anibt:deletionStatus', apiKey, releaseId),
  loginAnibtWeb: (account: AnibtWebAccount, themeMode: ThemeMode, bounds: DashboardBounds) => invoke('anibt:webLogin', account, themeMode, bounds),
  cancelAnibtWebLogin: () => invoke('anibt:cancelWebLogin'),
  setAnibtWebLoginBounds: (bounds: DashboardBounds) => invoke('anibt:setWebLoginBounds', bounds),
  onAnibtWebLoginHeight: (callback: (height: number) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, height: number): void => callback(height)
    ipcRenderer.on('anibt:webLoginHeight', listener)
    return () => ipcRenderer.removeListener('anibt:webLoginHeight', listener)
  },
  checkAnibtWeb: () => invoke('anibt:webCheck'),
  logoutAnibtWeb: (clearAll: boolean) => invoke('anibt:webLogout', clearAll),
  openAnibtDashboard: (bounds: DashboardBounds, themeMode: ThemeMode) =>
    invoke('anibt:openDashboard', bounds, themeMode),
  setAnibtDashboardBounds: (bounds: DashboardBounds) => invoke('anibt:setDashboardBounds', bounds),
  setAnibtDashboardVisible: (visible: boolean) => invoke('anibt:setDashboardVisible', visible),
  showDashboardMenu: (request: DashboardMenuRequest) => invoke('anibt:showDashboardMenu', request),
  hideDashboardMenu: (id?: string) => invoke('anibt:hideDashboardMenu', id),
  updateDashboardMenu: (settings: DashboardMenuSettings) => invoke('anibt:updateDashboardMenu', settings),
  onDashboardMenuEvent: (callback: (event: DashboardMenuEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: DashboardMenuEvent): void => callback(value)
    ipcRenderer.on('anibt:dashboardMenuEvent', listener)
    return () => ipcRenderer.removeListener('anibt:dashboardMenuEvent', listener)
  },
  reloadAnibtDashboard: () => invoke('anibt:reloadDashboard'),
  getDashboardNavigationState: () => invoke('anibt:dashboardNavigationState'),
  navigateAnibtDashboard: (action: DashboardNavigationAction) => invoke('anibt:navigateDashboard', action),
  onDashboardNavigationState: (callback: (state: DashboardNavigationState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: DashboardNavigationState): void => callback(state)
    ipcRenderer.on('anibt:dashboardNavigationStateChanged', listener)
    return () => ipcRenderer.removeListener('anibt:dashboardNavigationStateChanged', listener)
  },
  setAnibtWebLocale: (locale: Locale) => invoke('anibt:setWebLocale', locale),
  setAnibtDashboardTheme: (themeMode: ThemeMode) => invoke('anibt:setDashboardTheme', themeMode),
  closeAnibtDashboard: () => invoke('anibt:closeDashboard'),

  // 备用本地直发 / 站点账号
  localPublish: (payload: LocalPublishPayload) => invoke('local:publish', payload),
  removeLocalArchive: (recordId: string) => invoke('local:removeArchive', recordId),
  loginSite: (groupId: string, site: PublishSite, account: SiteAccountConfig, captchaCode = '') =>
    invoke('site:login', groupId, site, account, captchaCode),
  openSiteLogin: (groupId: string, site: PublishSite, account: SiteAccountConfig) =>
    invoke('site:openLogin', groupId, site, account),
  getDmhyCaptcha: (groupId: string, account: SiteAccountConfig) => invoke('site:dmhyCaptcha', groupId, account),
  clearSiteCookies: (groupId: string, site: PublishSite) => invoke('site:clearCookies', groupId, site),
  checkSite: (site: PublishSite, account: SiteAccountConfig) => invoke('site:check', site, account),
  searchMikan: (kind: MikanSearchKind, query: string) => invoke('mikan:search', kind, query),

  // 代理 / 繁化姬
  applyProxy: (proxy: ProxySettings) => invoke('proxy:apply', proxy),
  testProxySite: (site: PublishSite) => invoke('proxy:testSite', site),
  zhconvertTraditional: (text: string) => invoke('zhconvert:traditional', text)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
