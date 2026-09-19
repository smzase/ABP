<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { PopoverRoot, PopoverTrigger, PopoverPortal, PopoverContent } from 'reka-ui'
import { cn } from '@renderer/lib/utils.ts'
import { dashboardActive, openDashboardMenu, closeDashboardMenu } from '@renderer/lib/dashboard-overlay.ts'

const props = defineProps<{ class?: string; side?: 'top' | 'bottom' | 'left' | 'right'; align?: 'start' | 'center' | 'end'; dashboardMenu?: 'appearance' | 'language' }>()
const open = defineModel<boolean>('open', { default: false })
const native = computed(() => dashboardActive.value && !!props.dashboardMenu)
const trigger = ref<{ $el: HTMLElement }>()
let nativeId = ''
watch(() => open.value && native.value, active => {
  if (active && trigger.value && props.dashboardMenu) {
    nativeId = crypto.randomUUID()
    openDashboardMenu(nativeId, props.dashboardMenu, trigger.value.$el, props.side ?? 'bottom', () => { open.value = false })
  } else if (nativeId) {
    closeDashboardMenu(nativeId)
    nativeId = ''
  }
})
onBeforeUnmount(() => { if (nativeId) closeDashboardMenu(nativeId) })
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger ref="trigger" as-child>
      <slot name="trigger" />
    </PopoverTrigger>
    <PopoverPortal v-if="!native">
      <PopoverContent
        :side="side ?? 'bottom'"
        :align="align ?? 'start'"
        :side-offset="6"
        :class="
          cn(
            'z-50 w-auto rounded-md border bg-popover p-3 text-popover-foreground shadow-md outline-none',
            'data-[side=bottom]:animate-slide-down data-[side=top]:animate-slide-up data-[side=left]:animate-slide-up data-[side=right]:animate-slide-up data-[state=closed]:animate-fade-out',
            $props.class
          )
        "
      >
        <slot />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
