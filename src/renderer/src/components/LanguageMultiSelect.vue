<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ChevronDown, Plus } from '@lucide/vue'
import UiPopover from '@renderer/components/ui/UiPopover.vue'
import UiInput from '@renderer/components/ui/UiInput.vue'
import UiBadge from '@renderer/components/ui/UiBadge.vue'
import { DEFAULT_LANGUAGES } from '@shared/constants.ts'

/**
 * 字幕语言多选器：CHS / CHT / JP / EN 预设 + 自定义语言代码。
 * 选中顺序即 {{languageCode}} 拼接顺序（CHS&JP）。
 */
const props = defineProps<{ class?: string }>()
const model = defineModel<string[]>({ default: () => [] })
const { t } = useI18n()

const open = ref(false)
const customCode = ref('')

const allPresets = computed(() => {
  const extras = model.value.filter((l) => !DEFAULT_LANGUAGES.includes(l))
  return [...DEFAULT_LANGUAGES, ...extras]
})

function toggle(lang: string): void {
  if (model.value.includes(lang)) {
    model.value = model.value.filter((l) => l !== lang)
  } else {
    model.value = [...model.value, lang]
  }
}

function addCustom(): void {
  const v = customCode.value.trim().toUpperCase()
  if (v && !model.value.includes(v)) {
    model.value = [...model.value, v]
  }
  customCode.value = ''
}

void props
</script>

<template>
  <UiPopover v-model:open="open">
    <template #trigger>
      <button
        class="flex h-9 min-w-24 cursor-pointer items-center gap-1 rounded-md border border-input bg-popover px-2 py-1 text-sm shadow-sm hover:bg-accent"
      >
        <span v-if="model.length === 0" class="text-muted-foreground">—</span>
        <span v-else class="flex flex-wrap gap-1">
          <UiBadge v-for="l in model" :key="l" variant="secondary">{{ l }}</UiBadge>
        </span>
        <ChevronDown class="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>
    </template>
    <div class="flex w-52 flex-col gap-1">
      <button
        v-for="lang in allPresets"
        :key="lang"
        class="flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent"
        @click="toggle(lang)"
      >
        {{ lang }}
        <Check v-if="model.includes(lang)" class="h-4 w-4 text-primary" />
      </button>
      <div class="mt-1 flex gap-1.5 border-t pt-2">
        <UiInput
          v-model="customCode"
          class="h-7 text-xs"
          :placeholder="t('publish.addLanguage')"
          @keydown.enter.prevent="addCustom"
        />
        <button
          class="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md bg-secondary hover:bg-secondary/70"
          @click="addCustom"
        >
          <Plus class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  </UiPopover>
</template>
