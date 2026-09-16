<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Trash2, Loader2 } from '@lucide/vue'
import UiBadge from '@renderer/components/ui/UiBadge.vue'
import UiCard from '@renderer/components/ui/UiCard.vue'
import UiTooltip from '@renderer/components/ui/UiTooltip.vue'
import type { PublishRecord } from '@shared/types.ts'

/** 记录行：标题 + 元信息 + 条件删除按钮（无 releases:delete scope 时禁用并提示） */
const props = defineProps<{ record: PublishRecord; canDelete: boolean; deleting: boolean }>()
const emit = defineEmits<{ delete: [record: PublishRecord] }>()
const { t } = useI18n()

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString()
}

function onDelete(): void {
  emit('delete', props.record)
}
</script>

<template>
  <UiCard class="flex items-center gap-3 px-3 py-2">
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-1.5">
        <span class="truncate text-sm" :title="record.title">{{ record.title }}</span>
        <UiBadge v-if="record.preview" variant="secondary">{{ t('records.previewTag') }}</UiBadge>
        <UiBadge v-if="record.nyaa" variant="secondary">{{ t('records.nyaaTag') }}</UiBadge>
        <UiBadge v-if="record.status === 'deleted'" variant="destructive">{{ t('records.deleted') }}</UiBadge>
        <UiBadge v-else-if="record.status === 'failed'" variant="destructive">{{ t('publish.failed') }}</UiBadge>
      </div>
      <div class="mt-0.5 truncate text-xs text-muted-foreground">
        {{ record.groupName }} · EP {{ record.episodeKey }} · {{ record.resolution }} · {{ record.format }} ·
        {{ record.languages.join('&') }} · {{ formatTime(record.publishedAt) }}
        <template v-if="record.releaseId"> · {{ record.releaseId }}</template>
        <template v-if="record.message"> · {{ record.message }}</template>
      </div>
    </div>
    <Loader2 v-if="deleting" class="h-4 w-4 shrink-0 animate-spin text-primary" />
    <UiTooltip v-else :content="canDelete ? t('records.deleteRelease') : t('records.noDeleteScope')">
      <button
        class="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
        :disabled="!canDelete"
        @click="onDelete"
      >
        <Trash2 class="h-4 w-4" />
      </button>
    </UiTooltip>
  </UiCard>
</template>
