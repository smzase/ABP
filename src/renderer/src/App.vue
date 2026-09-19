<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { TooltipProvider } from 'reka-ui'
import TitleBar from '@renderer/components/layout/TitleBar.vue'
import SideBar from '@renderer/components/layout/SideBar.vue'
import UiConfirmDialog from '@renderer/components/ui/UiConfirmDialog.vue'
import { useAppStore } from '@renderer/stores/app.ts'

const app = useAppStore()
const currentRoute = useRoute()
const router = useRouter()
watch(() => [app.data.settings.publishMode, currentRoute.meta.anibtOnly], () => {
  if (app.data.settings.publishMode === 'local' && currentRoute.meta.anibtOnly) void router.replace('/publish')
})

/**
 * 窗口级拖放兜底：把文件拖到发布区以外的地方时，Chromium 默认会「导航」到该文件，
 * 整个应用会白屏。这里统一吞掉，真正的投放区自己 stopPropagation。
 */
function swallowDrop(e: DragEvent): void {
  e.preventDefault()
}

onMounted(() => {
  void app.load()
  window.addEventListener('dragover', swallowDrop)
  window.addEventListener('drop', swallowDrop)
})
</script>

<template>
  <!--
    TooltipProvider 必须包住整棵树：reka-ui 的 TooltipRoot 找不到它会直接抛
    「Injection `Symbol(TooltipProviderContext)` not found」，被包住的那段 UI 会静默消失
    （模板变量按钮、繁化姬转换按钮、Preview 开关都踩过这个坑）。
  -->
  <TooltipProvider :delay-duration="200">
    <div class="flex h-full flex-col bg-background text-foreground">
      <TitleBar />
      <div class="flex min-h-0 flex-1">
        <SideBar v-if="app.loaded" />
        <main class="min-w-0 flex-1 overflow-hidden">
          <router-view v-if="app.loaded" v-slot="{ Component, route }">
            <KeepAlive>
              <component :is="Component" v-if="route.meta.keepAlive" :key="String(route.name)" />
            </KeepAlive>
            <component :is="Component" v-if="!route.meta.keepAlive" />
          </router-view>
        </main>
      </div>
    </div>
    <!-- 全局确认弹窗（替代 window.confirm，见 lib/confirm.ts） -->
    <UiConfirmDialog />
  </TooltipProvider>
</template>
