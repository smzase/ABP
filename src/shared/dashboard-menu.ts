import type { AppearanceSettings, DashboardBounds, Locale } from './types.ts'

/** Public UI state only; credentials must never enter the menu renderer. */
export interface DashboardMenuSettings {
  appearance: AppearanceSettings
  locale: Locale
}

export interface DashboardMenuRequest {
  id: string
  kind: 'appearance' | 'language' | 'tooltip'
  anchor: DashboardBounds
  side: 'top' | 'bottom' | 'left' | 'right'
  text?: string
  settings: DashboardMenuSettings
}

export type DashboardMenuAction =
  | { type: 'theme'; value: 'light' | 'dark' }
  | { type: 'accent'; value: string }
  | { type: 'locale'; value: Locale }

export type DashboardMenuEvent =
  | { type: 'closed'; id: string }
  | { type: 'action'; action: DashboardMenuAction }
