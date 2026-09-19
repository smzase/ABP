<script setup lang="ts">
import { nextTick, ref } from 'vue'
import SidebarMenuContent from '@renderer/components/layout/SidebarMenuContent.vue'
import type { DashboardMenuAction, DashboardMenuRequest } from '@shared/dashboard-menu.ts'
import { i18n } from '@renderer/i18n/index.ts'
import { fontStack } from '@shared/font.ts'

const state = ref<DashboardMenuRequest | null>(null)
const host = ref<HTMLElement>()
const panel = ref<HTMLElement>()
const phase = ref<'pending' | 'open' | 'closed'>('pending')
window.dashboardMenu.onState(async next => {
  if (state.value?.id !== next.id) phase.value = 'pending'
  state.value = next
  document.documentElement.classList.toggle('dark', next.settings.appearance.mode === 'dark')
  document.documentElement.style.setProperty('--primary', next.settings.appearance.accent)
  document.documentElement.style.setProperty('--app-font-family', fontStack(next.settings.appearance.fontFamily))
  document.documentElement.lang = next.settings.locale
  i18n.global.locale.value = next.settings.locale
  await nextTick()
  // A hidden native view need not receive compositor frames. DOM layout is
  // ready after nextTick; main raises the view before its first visible paint.
  if (state.value?.id !== next.id || !host.value) return
  const rect = host.value.getBoundingClientRect()
  await window.dashboardMenu.painted(next.id, { width: rect.width, height: rect.height })
})
window.dashboardMenu.onPresentation(async value => {
  if (value.id !== state.value?.id) return
  phase.value = value.phase
  await nextTick()
  if (value.phase === 'closed' && value.id === state.value?.id && panel.value && getComputedStyle(panel.value).animationName === 'none') {
    void window.dashboardMenu.hidden(value.id)
  }
})
function animationEnd(event: AnimationEvent): void {
  if (event.target === panel.value && phase.value === 'closed' && state.value) void window.dashboardMenu.hidden(state.value.id)
}
function action(value: DashboardMenuAction): void {
  if (state.value) void window.dashboardMenu.action(state.value.id, value)
}
</script>

<template>
  <div v-if="state" ref="host" class="inline-block p-1 align-top" data-probe="native-dashboard-menu" :data-menu-id="state.id">
    <div ref="panel" :role="state.kind === 'tooltip' ? 'tooltip' : 'dialog'" :data-phase="phase" :data-side="state.side"
      class="native-menu-panel rounded-md border bg-popover text-popover-foreground shadow-sm"
      :class="state.kind === 'tooltip' ? 'max-w-xs px-3 py-1.5 text-xs' : 'p-3'" @animationend="animationEnd">
      <template v-if="state.kind === 'tooltip'">{{ state.text }}</template>
      <SidebarMenuContent v-else :kind="state.kind" :settings="state.settings" @action="action" />
    </div>
  </div>
</template>

<style>
.native-menu-panel[data-phase='pending'] { opacity: 0; }
.native-menu-panel[data-phase='open'] { animation: slide-up 150ms cubic-bezier(0.16, 1, 0.3, 1) both; }
.native-menu-panel[data-phase='open'][data-side='bottom'] { animation-name: slide-down; }
.native-menu-panel[data-phase='closed'] { animation: fade-out 100ms ease-in both; pointer-events: none; }
@media (prefers-reduced-motion: reduce) {
  .native-menu-panel { animation: none !important; }
}
html.dashboard-menu, html.dashboard-menu body, html.dashboard-menu #app {
  background: transparent;
  width: max-content;
  height: max-content;
  min-width: 0;
  margin: 0;
  overflow: hidden;
}
</style>
