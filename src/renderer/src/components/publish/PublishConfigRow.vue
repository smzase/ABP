<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { X, AlertTriangle } from '@lucide/vue'
import { RESOLUTIONS, VIDEO_FORMATS, SUBTITLE_TYPES } from '@shared/types.ts'
import { SUBTITLE_TYPE_I18N_KEY } from '@shared/constants.ts'
import { usePublishStore, type PublishEntry } from '@renderer/stores/publish.ts'
import UiSelect from '@renderer/components/ui/UiSelect.vue'
import UiSelectItem from '@renderer/components/ui/UiSelectItem.vue'
import UiInput from '@renderer/components/ui/UiInput.vue'
import UiTooltip from '@renderer/components/ui/UiTooltip.vue'
import UiBadge from '@renderer/components/ui/UiBadge.vue'
import LanguageMultiSelect from '@renderer/components/LanguageMultiSelect.vue'

/**
 * 阶段一行：文件名 + 番剧模板匹配 + 分辨率 / 格式 / 字幕类型 / 字幕语言选择。
 * 不改 props，走 patch → emit → store.replaceEntry。
 */
const props = defineProps<{ entry: PublishEntry }>()
const { t } = useI18n()
const store = usePublishStore()

const CUSTOM = '__custom'
const customResolution = ref(false)
const customFormat = ref(false)

const templateId = computed({
  get: () => props.entry.animeTemplateId,
  set: (v: string) => {
    // 先落库再联动：patch 会把 props.entry 换成新对象，
    // 拿旧引用去 applyTemplate 改的是已经被替换掉的孤儿对象（改了等于没改）
    patch({ animeTemplateId: v })
    store.applyTemplate(props.entry.id)
  }
})

function patch(p: Partial<PublishEntry>): void {
  store.patchEntryAndSyncTitle(props.entry.id, p)
}

function onResolution(v: string): void {
  if (v === CUSTOM) {
    customResolution.value = true
    patch({ resolution: '' })
  } else {
    customResolution.value = false
    patch({ resolution: v })
  }
}

function onFormat(v: string): void {
  if (v === CUSTOM) {
    customFormat.value = true
    patch({ format: '' })
  } else {
    customFormat.value = false
    patch({ format: v })
  }
}

/** 大写化放在失焦做：边打边转会把光标顶到末尾 */
function onFormatBlur(): void {
  if (!props.entry.format) customFormat.value = false
  else patch({ format: props.entry.format.toUpperCase() })
}

function onSubtitleType(value: string): void {
  const subtitleType = value as PublishEntry['subtitleType']
  patch(subtitleType === 'NONE' ? { subtitleType, languages: [] } : { subtitleType })
}

function remove(): void {
  store.removeEntry(props.entry.id)
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2.5">
    <!-- 文件名 + Nyaa tracker 提示 -->
    <div class="flex min-w-48 flex-1 items-center gap-2">
      <span class="truncate text-sm font-medium" :title="entry.fileName">{{ entry.fileName }}</span>
      <UiTooltip v-if="!entry.hasNyaaTracker" :content="t('publish.nyaaNoTracker')">
        <AlertTriangle class="h-3.5 w-3.5 shrink-0 text-amber-500" />
      </UiTooltip>
      <UiBadge v-if="entry.episode" variant="secondary">EP {{ entry.episode }}</UiBadge>
    </div>

    <!-- 番剧模板 -->
    <UiSelect v-model="templateId" class="w-44" :placeholder="t('publish.pickTemplate')" :title="t('publish.animeTemplate')">
      <UiSelectItem v-for="tpl in store.animeTemplates" :key="tpl.id" :value="tpl.id">
        {{ tpl.names.zh || tpl.names.native || `bgm:${tpl.bgmId}` }}
      </UiSelectItem>
      <div v-if="store.animeTemplates.length === 0" class="px-2 py-1.5 text-xs text-muted-foreground">
        {{ t('common.empty') }}
      </div>
    </UiSelect>

    <!-- 分辨率 -->
    <template v-if="!customResolution">
      <UiSelect
        probe="config-resolution-select"
        :model-value="entry.resolution"
        class="w-28"
        @update:model-value="onResolution"
      >
        <UiSelectItem v-for="r in RESOLUTIONS" :key="r" :value="r">{{ r }}</UiSelectItem>
        <UiSelectItem :value="CUSTOM">{{ t('common.custom') }}</UiSelectItem>
      </UiSelect>
    </template>
    <UiInput
      v-else
      :model-value="entry.resolution"
      class="w-28"
      placeholder="1440p"
      @update:model-value="(v: string) => patch({ resolution: v })"
      @blur="!entry.resolution && (customResolution = false)"
    />

    <!-- 格式 -->
    <template v-if="!customFormat">
      <UiSelect
        probe="config-format-select"
        :model-value="entry.format"
        class="w-24"
        @update:model-value="onFormat"
      >
        <UiSelectItem v-for="f in VIDEO_FORMATS" :key="f" :value="f">{{ f }}</UiSelectItem>
        <UiSelectItem :value="CUSTOM">{{ t('common.custom') }}</UiSelectItem>
      </UiSelect>
    </template>
    <UiInput
      v-else
      :model-value="entry.format"
      class="w-24"
      placeholder="AVI"
      @update:model-value="(v: string) => patch({ format: v })"
      @blur="onFormatBlur"
    />

    <!-- 字幕类型 -->
    <UiSelect
      probe="config-subtitle-type-select"
      :model-value="entry.subtitleType"
      class="w-28"
      @update:model-value="onSubtitleType"
    >
      <UiSelectItem v-for="s in SUBTITLE_TYPES" :key="s" :value="s">{{ t(SUBTITLE_TYPE_I18N_KEY[s]) }}</UiSelectItem>
    </UiSelect>

    <!-- 字幕语言 -->
    <LanguageMultiSelect
      probe="config-language-select"
      :disabled="entry.subtitleType === 'NONE'"
      :model-value="entry.languages"
      @update:model-value="(v: string[]) => patch({ languages: v })"
    />

    <!-- 移除 -->
    <button
      class="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      @click="remove"
    >
      <X class="h-4 w-4" />
    </button>
  </div>
</template>
