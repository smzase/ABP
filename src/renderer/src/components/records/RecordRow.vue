<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ExternalLink, Loader2, RotateCcw, Trash2 } from '@lucide/vue'
import { SITE_LABELS } from '@shared/sites.ts'
import type { PublishRecord, PublishSite } from '@shared/types.ts'
import UiBadge from '@renderer/components/ui/UiBadge.vue'
import UiButton from '@renderer/components/ui/UiButton.vue'
import UiCard from '@renderer/components/ui/UiCard.vue'
import UiTooltip from '@renderer/components/ui/UiTooltip.vue'
import { cn } from '@renderer/lib/utils.ts'

const props = defineProps<{ record: PublishRecord; canDelete: boolean; deleting: boolean; retrying: boolean }>()
const emit = defineEmits<{ delete: [record: PublishRecord]; retry: [record: PublishRecord, sites: PublishSite[]] }>()
const { t } = useI18n()
const expanded = ref(false)
const selected = ref<PublishSite[]>([])

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString()
}

function toggleSite(site: PublishSite, checked: boolean): void {
  selected.value = checked ? [...new Set([...selected.value, site])] : selected.value.filter((item) => item !== site)
}

watch(
  () => props.record.siteResults,
  (results) => {
    selected.value = selected.value.filter((site) => results.some((result) => result.site === site && !result.ok))
  },
  { deep: true }
)
</script>

<template>
  <UiCard class="px-3 py-2">
    <div class="flex items-center gap-3">
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
      <button v-if="record.mode === 'local'" class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent" :title="expanded ? t('common.collapse') : t('common.expand')" @click="expanded = !expanded">
        <ChevronDown class="h-4 w-4 transition-transform" :class="cn(expanded && 'rotate-180')" />
      </button>
      <Loader2 v-if="deleting || retrying" class="h-4 w-4 shrink-0 animate-spin text-primary" />
      <UiTooltip v-else-if="record.mode === 'anibt'" :content="canDelete ? t('records.deleteRelease') : t('records.noDeleteScope')">
        <button class="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-30" :disabled="!canDelete" @click="emit('delete', record)"><Trash2 class="h-4 w-4" /></button>
      </UiTooltip>
    </div>

    <div v-if="record.mode === 'local' && expanded" class="mt-2 flex flex-col gap-1.5 border-t pt-2">
      <div v-for="result in record.siteResults" :key="result.site" class="flex min-h-8 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted/50">
        <input v-if="!result.ok" type="checkbox" class="h-4 w-4 accent-primary" :checked="selected.includes(result.site)" @change="toggleSite(result.site, ($event.target as HTMLInputElement).checked)" />
        <span class="w-24 shrink-0">{{ SITE_LABELS[result.site] }}</span>
        <a v-if="result.ok && result.url" :href="result.url" target="_blank" rel="noreferrer" class="flex min-w-0 items-center gap-1 text-primary hover:underline"><ExternalLink class="h-3.5 w-3.5 shrink-0" /><span class="truncate">{{ result.url }}</span></a>
        <span v-else-if="result.ok" class="text-green-600">{{ t('publish.success') }}</span>
        <span v-else class="min-w-0 flex-1 break-all text-xs text-destructive">{{ result.error }}</span>
        <UiButton v-if="!result.ok" variant="ghost" size="sm" class="ml-auto" :disabled="retrying" @click="emit('retry', record, [result.site])"><RotateCcw class="h-3.5 w-3.5" />{{ t('records.retry') }}</UiButton>
      </div>
      <div v-if="selected.length" class="flex justify-end pt-1"><UiButton size="sm" :disabled="retrying" @click="emit('retry', record, selected)"><RotateCcw class="h-4 w-4" />{{ t('records.retrySelected', { count: selected.length }) }}</UiButton></div>
    </div>
  </UiCard>
</template>
