import { contextBridge, ipcRenderer } from 'electron'
import type { AppData, IpcChannels, ProxySettings, PublishPayload } from '../shared/types.ts'

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

  // 代理 / 繁化姬
  applyProxy: (proxy: ProxySettings) => invoke('proxy:apply', proxy),
  testProxy: (proxy: ProxySettings) => invoke('proxy:test', proxy),
  zhconvertTraditional: (text: string) => invoke('zhconvert:traditional', text)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
