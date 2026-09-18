<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, X, Loader2, CheckCircle2, XCircle, ExternalLink } from '@lucide/vue'
import { RESOLUTIONS, VIDEO_FORMATS, SUBTITLE_TYPES } from '@shared/types.ts'
import { SUBTITLE_TYPE_I18N_KEY } from '@shared/constants.ts'
import { usePublishStore, type PublishEntry } from '@renderer/stores/publish.ts'
import UiInput from '@renderer/components/ui/UiInput.vue'
import UiSelect from '@renderer/components/ui/UiSelect.vue'
import UiSelectItem from '@renderer/components/ui/UiSelectItem.vue'
import UiTagInput from '@renderer/components/ui/UiTagInput.vue'
import UiLabel from '@renderer/components/ui/UiLabel.vue'
import LanguageMultiSelect from '@renderer/components/LanguageMultiSelect.vue'
import { cn } from '@renderer/lib/utils.ts'

const UiMarkdownEditor = defineAsyncComponent(() => import('@renderer/components/ui/UiMarkdownEditor.vue'))

/**
 * 阶段二行：标题 / 集数 / 字幕语言 / 展开 / 移除。
 * 展开后可编辑：标题、版本、分辨率、格式、字幕类型、自定义标签（可拖拽排序）、简介（Markdown）。
 */
const props = defineProps<{ entry: PublishEntry }>()
const { t } = useI18n()
const store = usePublishStore()

function patch(p: Partial<PublishEntry>): void {
  store.replaceEntry({ ...props.entry, ...p })
}

function patchTitleField(p: Partial<PublishEntry>): void {
  store.patchEntryAndSyncTitle(props.entry.id, p)
}

function onSubtitleType(value: string): void {
  const subtitleType = value as PublishEntry['subtitleType']
  patchTitleField(subtitleType === 'NONE' ? { subtitleType, languages: [] } : { subtitleType })
}

function toggleExpand(): void {
  patch({ expanded: !props.entry.expanded })
}

function remove(): void {
  store.removeEntry(props.entry.id)
}
</script>

<template>
  <div class="rounded-lg border bg-card">
    <!-- 主行 -->
    <div class="flex items-start gap-2 px-3 py-2.5">
      <div class="min-w-0 flex-1">
        <UiInput
          data-probe="final-title-input"
          :model-value="entry.title"
          class="w-full"
          :class="cn(!entry.title.trim() && 'border-destructive')"
          :placeholder="t('publish.title')"
          @update:model-value="(v: string) => patch({ title: v })"
        />
        <div class="mt-1.5 flex min-w-0 items-baseline gap-1.5 px-0.5 text-[13px] leading-5 text-muted-foreground" data-probe="final-torrent-filename">
          <span class="shrink-0">{{ t('publish.torrentFileName') }}:</span>
          <span class="min-w-0 break-all font-mono text-foreground/75">{{ entry.fileName }}</span>
        </div>
      </div>
      <UiInput
        :model-value="entry.episode"
        class="w-20 shrink-0"
        :placeholder="t('publish.episode')"
        data-probe="final-episode-input"
        @update:model-value="(v: string) => patchTitleField({ episode: v })"
      />
      <LanguageMultiSelect
        probe="final-language-select"
        class="shrink-0"
        :disabled="entry.subtitleType === 'NONE'"
        :model-value="entry.languages"
        @update:model-value="(v: string[]) => patchTitleField({ languages: v })"
      />

      <!-- 发布状态 -->
      <Loader2 v-if="entry.publishing" class="h-4 w-4 shrink-0 animate-spin text-primary" />
      <CheckCircle2 v-else-if="entry.publishOk === true" class="h-4 w-4 shrink-0 text-green-500" />
      <XCircle v-else-if="entry.publishOk === false" class="h-4 w-4 shrink-0 text-destructive" />

      <button
        class="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
        :title="t('common.expand')"
        @click="toggleExpand"
      >
        <ChevronDown class="h-4 w-4 transition-transform" :class="cn(entry.expanded && 'rotate-180')" />
      </button>
      <button
        class="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        :title="t('common.remove')"
        @click="remove"
      >
        <X class="h-4 w-4" />
      </button>
    </div>

    <!--
      失败原因写在行里，不要只塞进 title 悬停提示。
      站点的 422 只说「Invalid request body」，本地体检又会点名到字段 ——
      这些话得让人一眼看见，否则用户只能看到一个红叉，完全不知道该改什么。
    -->
    <div
      v-if="entry.publishOk === false && entry.publishMessage"
      class="flex items-start gap-1.5 border-t border-destructive/30 bg-destructive/5 px-3 py-2 text-xs break-all text-destructive"
    >
      <XCircle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{{ entry.publishMessage }}</span>
    </div>
    <div
      v-if="entry.publishOk === true && entry.previewUrl"
      class="flex items-center gap-1.5 border-t border-green-500/30 bg-green-500/5 px-3 py-2 text-xs text-green-700 dark:text-green-300"
    >
      <ExternalLink class="h-3.5 w-3.5 shrink-0" />
      <a :href="entry.previewUrl" target="_blank" rel="noreferrer" class="truncate underline underline-offset-2">
        {{ t('publish.openPreview') }}
      </a>
    </div>

    <!-- 展开区 -->
    <div v-if="entry.expanded" class="flex flex-col gap-3 border-t px-3 py-3">
      <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div class="flex flex-col gap-1.5">
          <UiLabel>{{ t('publish.version') }}</UiLabel>
          <UiInput
            data-probe="final-version-input"
            :model-value="entry.version"
            placeholder="v1"
            @update:model-value="(v: string) => patchTitleField({ version: v })"
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <UiLabel>{{ t('publish.resolution') }}</UiLabel>
          <UiSelect
            probe="final-resolution-select"
            :model-value="entry.resolution"
            @update:model-value="(v: string) => patchTitleField({ resolution: v })"
          >
            <UiSelectItem v-for="r in RESOLUTIONS" :key="r" :value="r">{{ r }}</UiSelectItem>
            <UiSelectItem
              v-if="entry.resolution && !RESOLUTIONS.includes(entry.resolution as (typeof RESOLUTIONS)[number])"
              :value="entry.resolution"
            >
              {{ entry.resolution }}
            </UiSelectItem>
          </UiSelect>
        </div>
        <div class="flex flex-col gap-1.5">
          <UiLabel>{{ t('publish.format') }}</UiLabel>
          <UiSelect
            probe="final-format-select"
            :model-value="entry.format"
            @update:model-value="(v: string) => patchTitleField({ format: v })"
          >
            <UiSelectItem v-for="f in VIDEO_FORMATS" :key="f" :value="f">{{ f }}</UiSelectItem>
            <UiSelectItem
              v-if="entry.format && !VIDEO_FORMATS.includes(entry.format as (typeof VIDEO_FORMATS)[number])"
              :value="entry.format"
            >
              {{ entry.format }}
            </UiSelectItem>
          </UiSelect>
        </div>
        <div class="flex flex-col gap-1.5">
          <UiLabel>{{ t('publish.subtitleType') }}</UiLabel>
          <UiSelect
            probe="final-subtitle-type-select"
            :model-value="entry.subtitleType"
            @update:model-value="onSubtitleType"
          >
            <UiSelectItem v-for="s in SUBTITLE_TYPES" :key="s" :value="s">{{ t(SUBTITLE_TYPE_I18N_KEY[s]) }}</UiSelectItem>
          </UiSelect>
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <UiLabel>{{ t('publish.customTags') }}（{{ t('publish.customTagsHint') }}）</UiLabel>
        <UiTagInput
          :model-value="entry.customTags"
          placeholder="NF VOSTFR ADN"
          @update:model-value="(v: string[]) => patchTitleField({ customTags: v })"
        />
      </div>

      <div class="flex min-w-0 flex-col gap-1.5">
        <UiLabel>{{ t('publish.description') }}</UiLabel>
        <UiMarkdownEditor
          compact
          :model-value="entry.description"
          style="height: max(min(52vh, 520px), 340px)"
          @update:model-value="(v: string) => patch({ description: v })"
        />
      </div>
    </div>
  </div>
</template>
