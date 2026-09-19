<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { TooltipRoot, TooltipTrigger, TooltipPortal, TooltipContent, TooltipArrow } from 'reka-ui'
import { dashboardActive, openDashboardMenu, closeDashboardMenu } from '@renderer/lib/dashboard-overlay.ts'

/**
 * disabled：文字已经明明白白写在按钮上时（如展开状态的侧边栏），
 * 再浮一层同样的字纯属噪音。注意仍然要渲染 TooltipRoot/Trigger —— 直接 v-if 掉
 * 会在展开/收起之间重建整棵子树，按钮会闪一下。这里只是不给内容。
 */
const props = defineProps<{ content: string; side?: 'top' | 'bottom' | 'left' | 'right'; disabled?: boolean }>()
const open = ref(false)
const trigger = ref<{ $el: HTMLElement }>()
let nativeId = ''
watch(() => open.value && dashboardActive.value && !props.disabled, active => {
  if (active && trigger.value) {
    nativeId = crypto.randomUUID()
    openDashboardMenu(nativeId, 'tooltip', trigger.value.$el, props.side ?? 'top', () => { open.value = false }, props.content)
  } else if (nativeId) {
    closeDashboardMenu(nativeId)
    nativeId = ''
  }
})
onBeforeUnmount(() => { if (nativeId) closeDashboardMenu(nativeId) })
</script>

<template>
  <TooltipRoot v-model:open="open" :delay-duration="200" :disabled="disabled" :disable-hoverable-content="dashboardActive || undefined">
    <TooltipTrigger ref="trigger" as-child>
      <slot />
    </TooltipTrigger>
    <TooltipPortal v-if="!dashboardActive">
      <TooltipContent
        :side="side ?? 'top'"
        :side-offset="6"
        class="z-50 max-w-xs rounded-md border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md data-[side=bottom]:animate-slide-down data-[side=top]:animate-slide-up data-[side=left]:animate-slide-up data-[side=right]:animate-slide-up data-[state=closed]:animate-fade-out"
      >
        {{ content }}
        <TooltipArrow class="fill-popover" />
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>
