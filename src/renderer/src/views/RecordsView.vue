<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@renderer/stores/app.ts'
import UiBadge from '@renderer/components/ui/UiBadge.vue'
import UiCollapsible from '@renderer/components/ui/UiCollapsible.vue'
import RecordRow from '@renderer/components/records/RecordRow.vue'
import { confirm } from '@renderer/lib/confirm.ts'
import { cn } from '@renderer/lib/utils.ts'
import type { PublishRecord } from '@shared/types.ts'

/**
 * 发布记录：按番剧分组 / 列表两种展示；懒加载（IntersectionObserver 分批，每批 20 条）。
 * 删除发布：仅当该组 API Key 含 releases:delete scope 时可用（创建 Key 时勾选「删除番剧发布」）。
 */
const { t } = useI18n()
const app = useAppStore()

const viewMode = ref<'anime' | 'list'>('anime')

// ---------- 懒加载 ----------
const PAGE = 20
const visibleCount = ref(PAGE)
const sentinel = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

const sortedRecords = computed(() => [...app.data.records].sort((a, b) => b.publishedAt - a.publishedAt))
const visibleRecords = computed(() => sortedRecords.value.slice(0, visibleCount.value))

const groupedByAnime = computed(() => {
  const groups = new Map<string, PublishRecord[]>()
  for (const r of visibleRecords.value) {
    const key = r.animeName || r.title
    const list = groups.get(key)
    if (list) list.push(r)
    else groups.set(key, [r])
  }
  return [...groups.entries()]
})

onMounted(() => {
  observer = new IntersectionObserver((entries) => {
    if (entries[0]?.isIntersecting) {
      visibleCount.value = Math.min(visibleCount.value + PAGE, sortedRecords.value.length)
    }
  })
  if (sentinel.value) observer.observe(sentinel.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
})

// ---------- 删除 ----------
const deletingId = ref<string | null>(null)

function groupOf(record: PublishRecord) {
  return app.data.groups.find((g) => g.id === record.groupId)
}

function canDelete(record: PublishRecord): boolean {
  const g = groupOf(record)
  return !!g?.apiKey && g.scopes.includes('releases:delete') && !!record.releaseId && record.status === 'ok'
}

async function deleteRecord(record: PublishRecord): Promise<void> {
  const g = groupOf(record)
  if (!g?.apiKey) return
  if (!(await confirm({ title: t('records.deleteRelease'), description: t('records.deleteConfirm'), destructive: true })))
    return
  deletingId.value = record.id
  try {
    const res = await window.api.anibtDeleteRelease(g.apiKey, record.releaseId)
    if (!res.ok) {
      record.message = res.error
      return
    }
    if (res.state === 'completed') {
      record.status = 'deleted'
      return
    }
    // 202：轮询删除状态直到 completed / failed
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      const st = await window.api.anibtDeletionStatus(g.apiKey, record.releaseId)
      if (st.ok && st.state === 'completed') {
        record.status = 'deleted'
        return
      }
      if (st.ok && st.state === 'failed') {
        record.message = t('records.deleteFailed')
        return
      }
    }
    record.message = t('records.deleteStatusPending')
  } finally {
    deletingId.value = null
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
      <h2 class="text-lg font-semibold">{{ t('nav.records') }}</h2>
      <div class="flex items-center gap-1 rounded-lg bg-secondary p-1">
        <button
          class="cursor-pointer rounded-md px-3 py-1.5 text-sm transition-colors"
          :class="cn(viewMode === 'anime' ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground')"
          @click="viewMode = 'anime'"
        >
          {{ t('records.byAnime') }}
        </button>
        <button
          class="cursor-pointer rounded-md px-3 py-1.5 text-sm transition-colors"
          :class="cn(viewMode === 'list' ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground')"
          @click="viewMode = 'list'"
        >
          {{ t('records.byList') }}
        </button>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-4">
      <div v-if="visibleRecords.length === 0" class="py-16 text-center text-sm text-muted-foreground">
        {{ t('common.empty') }}
      </div>

      <!-- 按番剧分组 -->
      <template v-if="viewMode === 'anime'">
        <UiCollapsible
          v-for="[anime, records] in groupedByAnime"
          :key="anime"
          :title="anime"
          default-open
          class="mb-1"
        >
          <template #badge>
            <UiBadge variant="secondary" class="ml-1">{{ records.length }}</UiBadge>
          </template>
          <div class="flex flex-col gap-1.5">
            <RecordRow
              v-for="r in records"
              :key="r.id"
              :record="r"
              :can-delete="canDelete(r)"
              :deleting="deletingId === r.id"
              @delete="deleteRecord"
            />
          </div>
        </UiCollapsible>
      </template>

      <!-- 列表 -->
      <div v-else class="flex flex-col gap-1.5">
        <RecordRow
          v-for="r in visibleRecords"
          :key="r.id"
          :record="r"
          :can-delete="canDelete(r)"
          :deleting="deletingId === r.id"
          @delete="deleteRecord"
        />
      </div>

      <!-- 懒加载哨兵 -->
      <div ref="sentinel" class="h-8" />
      <div v-if="visibleCount < sortedRecords.length" class="pb-4 text-center text-xs text-muted-foreground">
        {{ t('records.loadMore') }}（{{ visibleCount }}/{{ sortedRecords.length }}）
      </div>
    </div>
  </div>
</template>
