<script setup lang="ts">
import { PopoverRoot, PopoverTrigger, PopoverPortal, PopoverContent } from 'reka-ui'
import { cn } from '@renderer/lib/utils.ts'

defineProps<{ class?: string; side?: 'top' | 'bottom' | 'left' | 'right'; align?: 'start' | 'center' | 'end' }>()
const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <slot name="trigger" />
    </PopoverTrigger>
    <PopoverPortal>
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
