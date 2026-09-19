import type { Api } from './index.ts'
import type { DashboardMenuApi } from './dashboard-menu.ts'

declare global {
  interface Window {
    api: Api
    dashboardMenu: DashboardMenuApi
  }
}

export {}
