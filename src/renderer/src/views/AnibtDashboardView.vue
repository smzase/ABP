<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2 } from '@lucide/vue'
import { useAppStore } from '@renderer/stores/app.ts'
import UiButton from '@renderer/components/ui/UiButton.vue'
import { dashboardActive } from '@renderer/lib/dashboard-overlay.ts'

const app = useAppStore()
const { t } = useI18n()
const host = ref<HTMLElement>()
const loading = ref(true)
const error = ref('')
let disposed = false
let resize: ResizeObserver | undefined
let pageVisible = true
let ready = false
let navigating = false

async function navigatePending(): Promise<void> {
  if (!ready || disposed || navigating) return
  navigating = true
  try {
    while (!disposed && app.pendingDashboardDestination) {
      const destination = app.pendingDashboardDestination
      error.value = ''
      try {
        await window.api.navigateAnibtDashboard(destination)
      } catch (reason) {
        if (disposed) return
        if (app.pendingDashboardDestination === destination) {
          error.value = String(reason)
          return // Keep the destination so retrying open() can retry navigation.
        }
      }
      if (!disposed && app.pendingDashboardDestination === destination) app.pendingDashboardDestination = null
    }
  } finally { navigating = false }
}
watch(() => app.pendingDashboardDestination, () => { void navigatePending() })

function bounds(): { x: number; y: number; width: number; height: number } {
  const rect = host.value!.getBoundingClientRect()
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}
function syncBounds(): void {
  if (!disposed && host.value) void window.api.setAnibtDashboardBounds(bounds())
}
function setVisible(): void {
  // Route visibility is independent of the temporary overlay presentation.
  void window.api.setAnibtDashboardVisible(pageVisible)
}
async function open(): Promise<void> {
  if (disposed || !host.value) return
  loading.value = true
  error.value = ''
  ready = false
  try {
    await window.api.openAnibtDashboard(bounds(), app.data.settings.appearance.mode)
    if (!disposed) {
      ready = true
      // The native view may not exist yet when the sidebar changes routes.
      // Drain only after open resolves; subsequent clicks use the same path.
      await navigatePending()
    }
    if (!disposed) {
      syncBounds()
      setVisible()
    }
  } catch (reason) {
    if (!disposed) error.value = String(reason)
  } finally { if (!disposed) loading.value = false }
}
onMounted(() => {
  dashboardActive.value = true
  resize = new ResizeObserver(syncBounds)
  resize.observe(host.value!)
  void open()
})
onBeforeUnmount(() => {
  dashboardActive.value = false
  disposed = true
  ready = false
  app.pendingDashboardDestination = null
  resize?.disconnect()
  pageVisible = false
  setVisible()
})
</script>

<template>
  <section class="flex h-full flex-col" data-probe="dashboard-page">
    <div ref="host" class="relative min-h-0 flex-1" data-probe="dashboard-host">
      <div v-if="loading || error" class="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6">
        <Loader2 v-if="loading" class="h-5 w-5 animate-spin text-muted-foreground" />
        <p v-if="error" role="alert" class="max-w-xl break-words text-sm text-destructive">{{ error }}</p>
        <UiButton v-if="error" variant="outline" @click="open">{{ t('webAccount.reload') }}</UiButton>
      </div>
    </div>
  </section>
</template>
