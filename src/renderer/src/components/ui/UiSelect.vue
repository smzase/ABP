<script setup lang="ts">
import {
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectIcon,
  SelectPortal,
  SelectContent,
  SelectViewport,
  SelectScrollUpButton,
  SelectScrollDownButton
} from 'reka-ui'
import { ChevronDown, ChevronUp } from '@lucide/vue'
import { cn } from '@renderer/lib/utils.ts'

/**
 * 下拉选择框（shadcn 约定 / reka-ui 实现）。
 *
 * 原先是原生 `<select>`：弹出的是**操作系统**的列表 —— 直角、系统配色、
 * 不跟主题走、也没有动画。这里换成 reka-ui 的 Select，弹层是应用内的 DOM，
 * 圆角/主题色/动效/键盘操作都跟其他组件一致。
 *
 * 选项用 `UiSelectItem`（不再是 `<option>`）。注意 reka-ui 把空字符串
 * 保留给「清空选中」，所以占位项不要写 `value=""`，用 `placeholder` 属性。
 */
defineProps<{
  class?: string
  contentClass?: string
  disabled?: boolean
  placeholder?: string
  /** 透传到 trigger，鼠标悬停提示 */
  title?: string
}>()
const model = defineModel<string>({ default: '' })
</script>

<template>
  <SelectRoot v-model="model" :disabled="disabled">
    <SelectTrigger
      :title="title"
      :class="
        cn(
          'flex h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-input bg-popover px-3 py-1 text-sm shadow-sm outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-muted-foreground',
          $props.class
        )
      "
    >
      <SelectValue :placeholder="placeholder ?? ''" class="truncate text-left" />
      <SelectIcon as-child>
        <ChevronDown class="h-4 w-4 shrink-0 opacity-60 transition-transform duration-200" />
      </SelectIcon>
    </SelectTrigger>

    <SelectPortal>
      <SelectContent
        position="popper"
        :side-offset="4"
        :class="
          cn(
            'z-50 max-h-64 min-w-(--reka-select-trigger-width) overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
            'data-[side=bottom]:animate-slide-down data-[side=top]:animate-slide-up data-[state=closed]:animate-fade-out',
            $props.contentClass
          )
        "
      >
        <SelectScrollUpButton class="flex h-5 cursor-default items-center justify-center">
          <ChevronUp class="h-3.5 w-3.5 opacity-60" />
        </SelectScrollUpButton>
        <SelectViewport class="p-0.5">
          <slot />
        </SelectViewport>
        <SelectScrollDownButton class="flex h-5 cursor-default items-center justify-center">
          <ChevronDown class="h-3.5 w-3.5 opacity-60" />
        </SelectScrollDownButton>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
