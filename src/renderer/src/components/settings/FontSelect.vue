<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ComboboxRoot, ComboboxAnchor, ComboboxTrigger, ComboboxPortal, ComboboxContent,
  ComboboxInput, ComboboxVirtualizer, ComboboxItem, ComboboxItemIndicator
} from 'reka-ui'
import { Check, ChevronDown, Search } from '@lucide/vue'

const props = defineProps<{ fonts: string[]; disabled?: boolean }>()
const model = defineModel<string>({ default: '' })
const { t } = useI18n()
const open = ref(false)
const query = ref('')
const SYSTEM_FONT = '__system_default__'
const selection = computed({
  get: () => model.value || SYSTEM_FONT,
  set: (value: string) => { model.value = value === SYSTEM_FONT ? '' : value }
})
const label = (value: string): string => value === SYSTEM_FONT ? t('settings.systemFont') : value
// Keep a saved family selectable even if it is absent on this machine.
const options = computed(() => [...new Set([SYSTEM_FONT, ...props.fonts, model.value].filter(Boolean))])
const filtered = computed(() => {
  const search = query.value.trim().toLocaleLowerCase()
  return search ? options.value.filter(value => label(value).toLocaleLowerCase().includes(search)) : options.value
})
watch(open, value => { if (value) query.value = '' })
</script>

<template>
  <ComboboxRoot
    v-model="selection"
    v-model:open="open"
    :disabled="disabled"
    :reset-search-term-on-blur="false"
    :reset-search-term-on-select="false"
    ignore-filter
    class="min-w-0 flex-1"
  >
    <ComboboxAnchor as-child>
      <ComboboxTrigger
        data-probe="font-select"
        tabindex="0"
        :aria-label="t('settings.font')"
        class="flex h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-input bg-popover px-3 py-1 text-sm shadow-sm outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        @keydown.enter.space.down.up.prevent="open = true"
      >
        <span class="truncate text-left">{{ label(selection) }}</span>
        <ChevronDown class="h-4 w-4 shrink-0 opacity-60 transition-transform duration-200" :class="open && 'rotate-180'" />
      </ComboboxTrigger>
    </ComboboxAnchor>
    <ComboboxPortal>
      <ComboboxContent
        position="popper"
        align="start"
        :side-offset="4"
        data-probe="font-popup"
        class="z-50 max-h-(--reka-combobox-content-available-height) w-(--reka-combobox-trigger-width) overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[side=bottom]:animate-slide-down data-[side=top]:animate-slide-up data-[state=closed]:animate-fade-out"
      >
        <div class="flex shrink-0 items-center gap-2 border-b px-3">
          <Search class="h-4 w-4 shrink-0 text-muted-foreground" />
          <ComboboxInput
            v-model="query"
            data-probe="font-search"
            :placeholder="t('settings.searchFont')"
            :aria-label="t('settings.searchFont')"
            class="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <!-- Fixed-height rows keep both layout and font loading bounded to the viewport.
             Use the app font here; the chosen family is previewed in OtherSettings. -->
        <div class="min-h-0 overflow-y-auto overscroll-contain p-1" :style="{ height: `${Math.min(Math.max(filtered.length, 1), 7) * 32 + 8}px` }" data-probe="font-viewport">
          <ComboboxVirtualizer v-slot="{ option }" :options="filtered" :estimate-size="32" :overscan="4" :text-content="label">
            <ComboboxItem
              :value="option"
              :text-value="label(option)"
              class="relative flex h-8 w-full cursor-pointer select-none items-center rounded-sm pr-7 pl-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[state=checked]:text-primary"
            >
              <span class="truncate">{{ label(option) }}</span>
              <ComboboxItemIndicator class="absolute right-2 flex items-center justify-center"><Check class="h-3.5 w-3.5" /></ComboboxItemIndicator>
            </ComboboxItem>
          </ComboboxVirtualizer>
          <p v-if="!filtered.length" class="px-2 py-1.5 text-xs text-muted-foreground" role="status">{{ t('common.empty') }}</p>
        </div>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>
