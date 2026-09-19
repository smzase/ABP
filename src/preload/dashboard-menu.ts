import { contextBridge, ipcRenderer } from 'electron'
import type { IpcChannels } from '../shared/types.ts'
import type { DashboardMenuAction, DashboardMenuRequest } from '../shared/dashboard-menu.ts'

const invoke = <K extends keyof IpcChannels>(channel: K, ...args: Parameters<IpcChannels[K]>): ReturnType<IpcChannels[K]> =>
  ipcRenderer.invoke(channel, ...args) as ReturnType<IpcChannels[K]>

// No store, network, account, or publishing bridge in this local UI surface.
const menu = {
  onState: (callback: (state: DashboardMenuRequest) => void) => {
    ipcRenderer.on('anibt:dashboardMenuState', (_event, state: DashboardMenuRequest) => callback(state))
  },
  onPresentation: (callback: (value: { id: string; phase: 'open' | 'closed' }) => void) => {
    ipcRenderer.on('anibt:dashboardMenuPresentation', (_event, value: { id: string; phase: 'open' | 'closed' }) => callback(value))
  },
  hidden: (id: string) => invoke('anibt:dashboardMenuHidden', id),
  painted: (id: string, size: { width: number; height: number }) => invoke('anibt:dashboardMenuPainted', id, size),
  action: (id: string, action: DashboardMenuAction) => invoke('anibt:dashboardMenuAction', id, action)
}
export type DashboardMenuApi = typeof menu
contextBridge.exposeInMainWorld('dashboardMenu', menu)
