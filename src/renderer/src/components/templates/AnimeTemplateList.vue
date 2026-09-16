<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@renderer/stores/app.ts'
import AnimeTemplateEditor from './AnimeTemplateEditor.vue'
import TemplateSideList from './TemplateSideList.vue'
import { confirm } from '@renderer/lib/confirm.ts'

/** 番剧模板：左侧列表（与标题/简介模板同一个组件，宽度也因此一致），右侧编辑器 */
const { t } = useI18n()
const app = useAppStore()

const selectedId = ref<string | null>(null)
const selected = computed(
  () => app.data.animeTemplates.find((x) => x.id === selectedId.value) ?? app.data.animeTemplates[0] ?? null
)

function groupName(groupId: string): string {
  return app.data.groups.find((g) => g.id === groupId)?.name ?? ''
}

const items = computed(() =>
  app.data.animeTemplates.map((tpl) => ({
    id: tpl.id,
    label: tpl.names.zh || tpl.names.native || `bgm:${tpl.bgmId ?? '?'}`,
    sub: [`bgm:${tpl.bgmId ?? '?'}`, groupName(tpl.groupId), tpl.nyaaProxy ? 'Nyaa' : ''].filter(Boolean).join(' · ')
  }))
)

/** 番剧模板没有单独的 name 字段，右键「重命名」改的是中文名 */
function rename(id: string, name: string): void {
  const tpl = app.data.animeTemplates.find((x) => x.id === id)
  if (!tpl) return
  tpl.names.zh = name
  tpl.updatedAt = Date.now()
}

function reorder(from: number, to: number): void {
  const list = app.data.animeTemplates
  if (from < 0 || to < 0 || from >= list.length || to >= list.length || from === to) return
  const [moved] = list.splice(from, 1)
  list.splice(to, 0, moved)
}

async function remove(id: string): Promise<void> {
  if (!(await confirm({ title: t('tpl.deleteConfirm'), destructive: true }))) return
  const idx = app.data.animeTemplates.findIndex((x) => x.id === id)
  if (idx >= 0) app.data.animeTemplates.splice(idx, 1)
}
</script>

<template>
  <div class="flex h-full">
    <TemplateSideList
      :items="items"
      :selected-id="selected?.id ?? null"
      variant="card"
      :empty-text="t('common.empty')"
      @select="(id: string) => (selectedId = id)"
      @rename="rename"
      @remove="remove"
      @reorder="reorder"
    />
    <div class="min-w-0 flex-1 overflow-y-auto">
      <AnimeTemplateEditor v-if="selected" :key="selected.id" :id="selected.id" />
      <div v-else class="p-8 text-center text-sm text-muted-foreground">{{ t('common.empty') }}</div>
    </div>
  </div>
</template>
