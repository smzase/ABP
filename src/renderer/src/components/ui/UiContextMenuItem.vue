<script setup lang="ts">
import { ContextMenuItem } from 'reka-ui'
import { cn } from '@renderer/lib/utils.ts'

/** 右键菜单项。destructive 用红色（删除类操作） */
defineProps<{ destructive?: boolean; class?: string }>()
defineEmits<{ select: [] }>()
</script>

<template>
  <ContextMenuItem
    :class="
      cn(
        'flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors',
        destructive
          ? 'text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive'
          : 'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground',
        $props.class
      )
    "
    @select="$emit('select')"
  >
    <slot />
  </ContextMenuItem>
</template>
