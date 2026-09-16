<script setup lang="ts">
import { ContextMenuRoot, ContextMenuTrigger, ContextMenuPortal, ContextMenuContent } from 'reka-ui'
import { cn } from '@renderer/lib/utils.ts'

/**
 * 右键菜单。`#trigger` 插槽是右键区域，默认插槽是菜单内容（放 UiContextMenuItem）。
 * as-child 让 trigger 不额外套一层元素，直接把事件挂到插槽里的真实节点上。
 */
defineProps<{ class?: string }>()
</script>

<template>
  <ContextMenuRoot>
    <ContextMenuTrigger as-child>
      <slot name="trigger" />
    </ContextMenuTrigger>
    <ContextMenuPortal>
      <ContextMenuContent
        :class="
          cn(
            'z-50 min-w-36 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
            'animate-slide-down data-[state=closed]:animate-fade-out',
            $props.class
          )
        "
      >
        <slot />
      </ContextMenuContent>
    </ContextMenuPortal>
  </ContextMenuRoot>
</template>
