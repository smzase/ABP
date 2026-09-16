<script setup lang="ts">
import { SelectItem, SelectItemText, SelectItemIndicator } from 'reka-ui'
import { Check } from '@lucide/vue'
import { cn } from '@renderer/lib/utils.ts'

/** UiSelect 的选项。value 不能是空字符串（reka-ui 用它表示「清空」），占位走 UiSelect 的 placeholder */
defineProps<{ value: string; disabled?: boolean; class?: string }>()
</script>

<template>
  <SelectItem
    :value="value"
    :disabled="disabled"
    :class="
      cn(
        'relative flex w-full cursor-pointer select-none items-center gap-2 rounded-sm py-1.5 pl-2 pr-7 text-sm outline-none transition-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[state=checked]:text-primary data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        $props.class
      )
    "
  >
    <SelectItemText class="truncate">
      <slot />
    </SelectItemText>
    <SelectItemIndicator class="absolute right-2 flex items-center justify-center">
      <Check class="h-3.5 w-3.5" />
    </SelectItemIndicator>
  </SelectItem>
</template>
