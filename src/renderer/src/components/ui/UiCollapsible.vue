<script setup lang="ts">
import { ref } from 'vue'
import { CollapsibleRoot, CollapsibleTrigger, CollapsibleContent } from 'reka-ui'
import { ChevronDown } from '@lucide/vue'
import { cn } from '@renderer/lib/utils.ts'


/**
 * 折叠面板。
 * 注意：CollapsibleRoot 的 `open` 一旦传值就进入「受控模式」，`defaultOpen` 会被忽略。
 * 所以这里自己持有状态，用 defaultOpen 作初值，而不是同时传 open + defaultOpen。
 */
const props = defineProps<{ title: string; defaultOpen?: boolean; class?: string; triggerClass?: string }>()
const open = defineModel<boolean | undefined>('open', { default: undefined })

const inner = ref(props.defaultOpen ?? false)

function onUpdate(v: boolean): void {
  inner.value = v
  open.value = v
}
</script>

<template>
  <div :class="$props.class">
    <CollapsibleRoot :open="open ?? inner" @update:open="onUpdate">
      <div class="flex items-center justify-between gap-2">
        <slot name="leading" />
        <CollapsibleTrigger
          :class="cn('flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-accent [&[data-state=open]>svg]:rotate-180', props.triggerClass)"
        >
          <ChevronDown class="h-4 w-4 shrink-0 transition-transform" />
          {{ title }}
          <slot name="badge" />
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent
        class="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down"
      >
        <div class="px-2 py-1">
          <slot />
        </div>
      </CollapsibleContent>
    </CollapsibleRoot>
  </div>
</template>
