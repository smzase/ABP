<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus } from '@lucide/vue'
import { useAppStore } from '@renderer/stores/app.ts'
import { genId } from '@renderer/lib/utils.ts'
import UiButton from '@renderer/components/ui/UiButton.vue'
import TitleTemplateEditor from '@renderer/components/templates/TitleTemplateEditor.vue'
import DescTemplateEditor from '@renderer/components/templates/DescTemplateEditor.vue'
import AnimeTemplateList from '@renderer/components/templates/AnimeTemplateList.vue'
import TemplateSideList from '@renderer/components/templates/TemplateSideList.vue'
import BgmSearchDialog from '@renderer/components/templates/BgmSearchDialog.vue'
import { confirm } from '@renderer/lib/confirm.ts'
import { cn } from '@renderer/lib/utils.ts'

/**
 * 番剧模板页：左上角三个可切换按钮「标题模板 / 简介模板 / 番剧模板」，右侧「+」添加。
 */
const { t } = useI18n()
const app = useAppStore()

type Tab = 'title' | 'desc' | 'anime'
// 番剧模板排第一并作为默认：它是这一页的主角，标题/简介模板是被它引用的素材
const tab = ref<Tab>('anime')

const TABS: Array<{ key: Tab; labelKey: string }> = [
  { key: 'anime', labelKey: 'tpl.animeTemplates' },
  { key: 'title', labelKey: 'tpl.titleTemplates' },
  { key: 'desc', labelKey: 'tpl.descTemplates' }
]

// 标题/简介模板的选中项
const selectedTitleId = ref<string | null>(null)
const selectedDescId = ref<string | null>(null)

const selectedTitle = computed(
  () => app.data.titleTemplates.find((x) => x.id === selectedTitleId.value) ?? app.data.titleTemplates[0] ?? null
)
const selectedDesc = computed(
  () => app.data.descTemplates.find((x) => x.id === selectedDescId.value) ?? app.data.descTemplates[0] ?? null
)

const addDialogOpen = ref(false)

// ---------- 左侧列表：改名 / 删除 / 拖拽排序 ----------
const titleItems = computed(() => app.data.titleTemplates.map((x) => ({ id: x.id, label: x.name })))
const descItems = computed(() => app.data.descTemplates.map((x) => ({ id: x.id, label: x.name })))

/** 标题/简介模板都是 { id, name }，改名逻辑一份就够 */
function renameIn(list: Array<{ id: string; name: string }>, id: string, name: string): void {
  const item = list.find((x) => x.id === id)
  if (item) item.name = name
}

/** 拖拽换位：把 from 抽出来插到 to */
function reorder<T>(list: T[], from: number, to: number): void {
  if (from < 0 || to < 0 || from >= list.length || to >= list.length || from === to) return
  const [moved] = list.splice(from, 1)
  list.splice(to, 0, moved)
}

async function removeTitle(id: string): Promise<void> {
  if (!(await confirm({ title: t('tpl.deleteConfirm'), destructive: true }))) return
  const idx = app.data.titleTemplates.findIndex((x) => x.id === id)
  if (idx >= 0) app.data.titleTemplates.splice(idx, 1)
  if (app.data.defaultTitleTemplateId === id) app.data.defaultTitleTemplateId = null
}

async function removeDesc(id: string): Promise<void> {
  if (!(await confirm({ title: t('tpl.deleteConfirm'), destructive: true }))) return
  const idx = app.data.descTemplates.findIndex((x) => x.id === id)
  if (idx >= 0) app.data.descTemplates.splice(idx, 1)
  if (app.data.defaultDescTemplateId === id) app.data.defaultDescTemplateId = null
}

const addLabel = computed(() => {
  if (tab.value === 'title') return t('tpl.addTitleTemplate')
  if (tab.value === 'desc') return t('tpl.addDescTemplate')
  return t('tpl.addAnimeTemplate')
})

function onAdd(): void {
  if (tab.value === 'title') {
    const id = genId()
    app.data.titleTemplates.push({
      id,
      name: `${t('tpl.titleTemplates')} ${app.data.titleTemplates.length + 1}`,
      template: app.data.titleTemplates[0]?.template ?? ''
    })
    selectedTitleId.value = id
  } else if (tab.value === 'desc') {
    const id = genId()
    app.data.descTemplates.push({
      id,
      name: `${t('tpl.descTemplates')} ${app.data.descTemplates.length + 1}`,
      markdown: ''
    })
    selectedDescId.value = id
  } else {
    addDialogOpen.value = true
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 顶栏：三切换 + 添加 -->
    <div class="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
      <div class="flex items-center gap-1 rounded-lg bg-secondary p-1">
        <button
          v-for="item in TABS"
          :key="item.key"
          class="cursor-pointer rounded-md px-3 py-1.5 text-sm transition-colors"
          :class="cn(tab === item.key ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground')"
          @click="tab = item.key"
        >
          {{ t(item.labelKey) }}
        </button>
      </div>
      <UiButton size="sm" @click="onAdd">
        <Plus class="h-4 w-4" /> {{ addLabel }}
      </UiButton>
    </div>

    <!-- 内容 -->
    <div class="min-h-0 flex-1 overflow-hidden">
      <!-- 番剧模板 -->
      <AnimeTemplateList v-if="tab === 'anime'" />

      <!-- 标题模板 -->
      <div v-else-if="tab === 'title'" class="flex h-full">
        <TemplateSideList
          :items="titleItems"
          :selected-id="selectedTitle?.id ?? null"
          :empty-text="t('common.empty')"
          :default-id="app.data.defaultTitleTemplateId"
          @select="(id: string) => (selectedTitleId = id)"
          @rename="(id: string, name: string) => renameIn(app.data.titleTemplates, id, name)"
          @remove="(id: string) => removeTitle(id)"
          @set-default="(id: string) => (app.data.defaultTitleTemplateId = app.data.defaultTitleTemplateId === id ? null : id)"
          @reorder="(from: number, to: number) => reorder(app.data.titleTemplates, from, to)"
        />
        <div class="min-w-0 flex-1 overflow-y-auto">
          <TitleTemplateEditor v-if="selectedTitle" :key="selectedTitle.id" :id="selectedTitle.id" />
          <div v-else class="p-8 text-center text-sm text-muted-foreground">{{ t('common.empty') }}</div>
        </div>
      </div>

      <!-- 简介模板 -->
      <div v-else class="flex h-full">
        <TemplateSideList
          :items="descItems"
          :selected-id="selectedDesc?.id ?? null"
          :empty-text="t('common.empty')"
          :default-id="app.data.defaultDescTemplateId"
          @select="(id: string) => (selectedDescId = id)"
          @rename="(id: string, name: string) => renameIn(app.data.descTemplates, id, name)"
          @remove="(id: string) => removeDesc(id)"
          @set-default="(id: string) => (app.data.defaultDescTemplateId = app.data.defaultDescTemplateId === id ? null : id)"
          @reorder="(from: number, to: number) => reorder(app.data.descTemplates, from, to)"
        />
        <div class="min-w-0 flex-1 overflow-y-auto">
          <DescTemplateEditor v-if="selectedDesc" :key="selectedDesc.id" :id="selectedDesc.id" />
          <div v-else class="p-8 text-center text-sm text-muted-foreground">{{ t('common.empty') }}</div>
        </div>
      </div>
    </div>

    <!-- 添加番剧模板：先搜索/输 bgmId，选好再建 -->
    <BgmSearchDialog v-model:open="addDialogOpen" />
  </div>
</template>
