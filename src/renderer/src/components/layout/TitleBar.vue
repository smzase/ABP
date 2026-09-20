<script setup lang="ts">
import { ArrowLeft, ArrowRight, Minus, RefreshCw, Square, UserRound, X } from '@lucide/vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '@renderer/stores/app.ts'
import { cn } from '@renderer/lib/utils.ts'

/**
 * 自绘标题栏：不用系统标题栏，且按需求不在标题栏写项目名。
 * 左侧为发布模式切换，右侧为窗口控制按钮；仍不显示项目名。
 */
const app = useAppStore()
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const mode = computed(() => app.data.settings.publishMode)
const isDashboard = computed(() => mode.value === 'anibt' && route.name === 'anibt-dashboard')
const refreshingDashboard = ref(false)

function setMode(next: 'anibt' | 'local'): void {
  app.data.settings.publishMode = next
  if (next === 'local') void window.api.closeAnibtDashboard()
}
function openWebAccount(): void {
  void router.push({ name: 'anibt-web-account' })
}
async function refreshDashboard(): Promise<void> {
  if (refreshingDashboard.value) return
  refreshingDashboard.value = true
  try { await window.api.reloadAnibtDashboard() } finally { refreshingDashboard.value = false }
}
async function navigateDashboard(action: 'back' | 'forward'): Promise<void> {
  await window.api.navigateAnibtDashboard(action)
}
function minimize(): void {
  void window.api.minimizeWindow()
}
function toggleMaximize(): void {
  void window.api.toggleMaximizeWindow()
}
function close(): void {
  void window.api.closeWindow()
}
</script>

<template>
  <div class="app-drag flex h-11 shrink-0 items-center justify-between border-b bg-background pl-4">
    <div class="app-no-drag flex h-8 items-center rounded-md bg-secondary p-0.5" data-probe="publish-mode-switch">
      <button
        v-for="item in [{ key: 'anibt', label: 'AniBT' }, { key: 'local', label: t('titleBar.local') }] as const"
        :key="item.key"
        :data-publish-mode="item.key"
        class="h-7 cursor-pointer rounded px-4 text-sm transition-colors"
        :class="cn(mode === item.key ? 'bg-card font-medium text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground')"
        @click="setMode(item.key)"
      >
        {{ item.label }}
      </button>
    </div>
    <div class="app-no-drag flex min-w-0 items-center">
      <div v-if="isDashboard" class="mr-2 flex min-w-0 items-center gap-1">
        <button class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40" data-probe="titlebar-dashboard-back" :disabled="!app.dashboardCanGoBack" title="Back" @click="navigateDashboard('back')"><ArrowLeft class="h-4 w-4" /></button>
        <button class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40" data-probe="titlebar-dashboard-forward" :disabled="!app.dashboardCanGoForward" title="Forward" @click="navigateDashboard('forward')"><ArrowRight class="h-4 w-4" /></button>
        <button class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50" data-probe="titlebar-dashboard-refresh" :disabled="refreshingDashboard" title="Refresh" @click="refreshDashboard"><RefreshCw class="h-4 w-4" :class="refreshingDashboard ? 'animate-spin' : ''" /></button>
        <button
          class="flex h-9 cursor-pointer items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          data-probe="titlebar-anibt-account"
          @click="openWebAccount"
        >
          <UserRound class="h-4 w-4" />
          <span>{{ t('nav.anibtWebAccount') }}</span>
        </button>
      </div>
      <button
        class="flex h-11 w-11 cursor-pointer items-center justify-center text-muted-foreground hover:bg-accent"
        @click="minimize"
      >
        <Minus class="h-4 w-4" />
      </button>
      <button
        class="flex h-11 w-11 cursor-pointer items-center justify-center text-muted-foreground hover:bg-accent"
        @click="toggleMaximize"
      >
        <Square class="h-3.5 w-3.5" />
      </button>
      <button
        class="flex h-11 w-11 cursor-pointer items-center justify-center text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
        @click="close"
      >
        <X class="h-4 w-4" />
      </button>
    </div>
  </div>
</template>
