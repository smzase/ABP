<script setup lang="ts">
import { TooltipRoot, TooltipTrigger, TooltipPortal, TooltipContent, TooltipArrow } from 'reka-ui'

/**
 * disabled：文字已经明明白白写在按钮上时（如展开状态的侧边栏），
 * 再浮一层同样的字纯属噪音。注意仍然要渲染 TooltipRoot/Trigger —— 直接 v-if 掉
 * 会在展开/收起之间重建整棵子树，按钮会闪一下。这里只是不给内容。
 */
defineProps<{ content: string; side?: 'top' | 'bottom' | 'left' | 'right'; disabled?: boolean }>()
</script>

<template>
  <TooltipRoot :delay-duration="200" :disabled="disabled">
    <TooltipTrigger as-child>
      <slot />
    </TooltipTrigger>
    <TooltipPortal>
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
