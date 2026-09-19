import { ref, watch } from 'vue'
import type { DashboardMenuAction, DashboardMenuRequest, DashboardMenuSettings } from '@shared/dashboard-menu.ts'

export const dashboardActive = ref(false)
let settings: DashboardMenuSettings = { appearance: { mode: 'light', accent: '#fb7299', fontFamily: '' }, locale: 'zh-CN' }
let current: { id: string; kind: DashboardMenuRequest['kind']; trigger: HTMLElement; close: () => void } | null = null

export function initDashboardMenus(onAction: (action: DashboardMenuAction) => void): void {
  window.api.onDashboardMenuEvent(event => {
    if (event.type === 'action') onAction(event.action)
    else if (current?.id === event.id) {
      const previous = current
      current = null
      previous.close()
    }
  })
  document.addEventListener('pointerdown', event => {
    if (current && !current.trigger.contains(event.target as Node)) closeDashboardMenu(current.id)
  }, true)
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && current) closeDashboardMenu(current.id)
  })
  watch(dashboardActive, active => { if (!active && current) closeDashboardMenu(current.id) })
}

export function updateDashboardMenuSettings(next: DashboardMenuSettings): void {
  settings = next
  if (dashboardActive.value) void window.api.updateDashboardMenu(next)
}

export function openDashboardMenu(id: string, kind: DashboardMenuRequest['kind'], trigger: HTMLElement,
  side: DashboardMenuRequest['side'], close: () => void, text?: string): void {
  if (kind === 'tooltip' && current && current.kind !== 'tooltip') { close(); return }
  if (current && current.id !== id) {
    const previous = current
    current = null
    previous.close()
  }
  const r = trigger.getBoundingClientRect()
  current = { id, kind, trigger, close }
  void window.api.showDashboardMenu({ id, kind, side, text,
    anchor: { x: r.x, y: r.y, width: r.width, height: r.height }, settings })
    .then(shown => { if (!shown && current?.id === id) closeDashboardMenu(id) })
    .catch(() => closeDashboardMenu(id))
}

export function closeDashboardMenu(id: string): void {
  if (current?.id === id) {
    const previous = current
    current = null
    previous.close()
  }
  void window.api.hideDashboardMenu(id)
}
