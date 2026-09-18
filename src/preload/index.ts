import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppData,
  IpcChannels,
  LocalPublishPayload,
  MikanSearchKind,
  ProxySettings,
  PublishPayload,
  PublishSite,
  SiteAccountConfig
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
