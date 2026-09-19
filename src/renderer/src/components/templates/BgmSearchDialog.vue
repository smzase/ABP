<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search, Loader2 } from '@lucide/vue'
import type { BgmSearchItem, MikanSearchItem } from '@shared/types.ts'
import { selectMikanBangumiMatch } from '@shared/mikan.ts'
import { useAppStore } from '@renderer/stores/app.ts'
import { genId } from '@renderer/lib/utils.ts'
import UiDialog from '@renderer/components/ui/UiDialog.vue'
import UiInput from '@renderer/components/ui/UiInput.vue'
import UiButton from '@renderer/components/ui/UiButton.vue'
import UiSeparator from '@renderer/components/ui/UiSeparator.vue'

/**
 * 创建入口：Bangumi 搜索、手动 bgmId 或仅中文名；pickOnly 模式只返回所选条目。
 */
const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ pickOnly?: boolean; initialQuery?: string }>()
const emit = defineEmits<{ select: [item: BgmSearchItem] }>()
const { t } = useI18n()
const app = useAppStore()

const query = ref('')
const searching = ref(false)
const results = ref<BgmSearchItem[]>([])
const searched = ref(false)
const manualId = ref('')
const manualName = ref('')
const searchError = ref('')
const validManualId = computed(() => Number.isSafeInteger(Number(manualId.value)) && Number(manualId.value) > 0)
const creatingId = ref<number | null>(null)

function emptyFilenameExample() {
  return { fileName: '', languages: [], subtitleType: null, resolution: '', format: '', codec: '', bitDepth: '', audioCodec: '', source: '',  }
}

function defaultTemplateContent(): { title: string; description: string } {
  const title = app.data.titleTemplates.find((item) => item.id === app.data.defaultTitleTemplateId)?.template ?? ''
  const description = app.data.descTemplates.find((item) => item.id === app.data.defaultDescTemplateId)?.markdown ?? ''
  return { title, description }
}

async function findMikanBangumiId(bgmId: number, names: string[]): Promise<number | null> {
  const queries = [...new Set(names.map((name) => name.trim()).filter(Boolean))].slice(0, 3)
  if (queries.length === 0) return null
  try {
    const responses = await Promise.allSettled(queries.map((name) => window.api.searchMikan('bangumi', name)))
    const merged = new Map<number, MikanSearchItem>()
    for (const settled of responses) {
      if (settled.status !== 'fulfilled') continue
      const response = settled.value
      for (const item of response.ok ? (response.data ?? []) : []) merged.set(item.id, item)
    }
    return selectMikanBangumiMatch([...merged.values()], bgmId, names)?.id ?? null
  } catch {
    // Mikan 不可达不应阻断 Bangumi 模板创建；按需求保留为空即可。
    return null
  }
}

let debounce: ReturnType<typeof setTimeout> | null = null
let searchRequest = 0
watch(open, value => {
  if (value) query.value = props.initialQuery ?? ''
  else {
    searchRequest++
    if (debounce) clearTimeout(debounce)
    searching.value = false
  }
})
onBeforeUnmount(() => {
  searchRequest++
  if (debounce) clearTimeout(debounce)
})
watch(query, () => {
  searchRequest++
  if (debounce) clearTimeout(debounce)
  if (!query.value.trim()) {
    results.value = []
    searched.value = false
    searching.value = false
    return
  }
  debounce = setTimeout(() => void search(), 350)
})

async function search(): Promise<void> {
  if (debounce) clearTimeout(debounce)
  const q = query.value.trim()
  if (!q) return
  const request = ++searchRequest
  searching.value = true
  searchError.value = ''
  try {
    const res = await window.api.anibtBgmSearch(q, 10)
    if (request !== searchRequest || !open.value) return
    results.value = res.ok ? (res.data ?? []) : []
    searchError.value = res.ok ? '' : (res.error ?? '')
    searched.value = true
  } catch (error) {
    if (request !== searchRequest) return
    results.value = []
    searched.value = true
    searchError.value = String(error)
  } finally {
    if (request === searchRequest) searching.value = false
  }
}

/**
 * 新建番剧模板：仅复制显式默认模板，否则标题模板与简介留空。
 * 不预填第一条全局模板 —— 那会让人以为「已经配好了」，发布时才发现套的是别的番的模板。
 * 要用全局模板就在编辑器里显式选一个（选完还能改，改了就算「自定义」）。
 */
async function createFromSearch(item: BgmSearchItem): Promise<void> {
  if (props.pickOnly) {
    emit('select', item)
    close()
    return
  }
  if (creatingId.value !== null) return
  creatingId.value = item.bgmId
  try {
    const detail = await window.api.anibtBgmDetails(item.bgmId)
    const names = detail.ok && detail.data ? detail.data : {
      bgmId: item.bgmId,
      name: item.name || '',
      nameCn: item.nameCn || '',
      romaji: '',
      en: ''
    }
    const mikanBangumiId = await findMikanBangumiId(item.bgmId, [
      names.nameCn,
      names.name,
      names.romaji,
      names.en
    ])
    const defaults = defaultTemplateContent()
    app.data.animeTemplates.push({
      id: genId(),
      bgmId: item.bgmId,
      mikanBangumiId,
      names: {
        zh: names.nameCn || item.nameCn || '',
        zhTw: '',
        romaji: names.romaji || '',
        en: names.en || '',
        native: names.name || item.name || ''
      },
      groupId: '',
      customTags: [],
      nyaaProxy: false,
      nyaaInformation: '',
      nyaaHidden: false,
      nyaaRemake: false,
      traditionalizeTitle: false,
      titleTemplates: { simp: defaults.title, trad: defaults.title, both: defaults.title },
      descriptionMd: defaults.description,
      filenameExamples: { simpInternal: emptyFilenameExample(), tradInternal: emptyFilenameExample(), embedded: emptyFilenameExample() },
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
    close()
  } finally {
    creatingId.value = null
  }
}
function createFromManual(): void {
  const id = Number(manualId.value.trim())
  if (!validManualId.value || creatingId.value !== null) return
  createBlank(id, '')
}
function createFromName(): void {
  if (creatingId.value !== null) return
  const name = manualName.value.trim()
  if (name) createBlank(null, name)
}
function createBlank(id: number | null, name: string): void {
  const defaults = defaultTemplateContent()
  app.data.animeTemplates.push({
    id: genId(),
    bgmId: id,
    mikanBangumiId: null,
    names: { zh: name, zhTw: '', romaji: '', en: '', native: '' },
    groupId: '',
    customTags: [],
    nyaaProxy: false,
    nyaaInformation: '',
    nyaaHidden: false,
    nyaaRemake: false,
    traditionalizeTitle: false,
    titleTemplates: { simp: defaults.title, trad: defaults.title, both: defaults.title },
    descriptionMd: defaults.description,
    filenameExamples: { simpInternal: emptyFilenameExample(), tradInternal: emptyFilenameExample(), embedded: emptyFilenameExample() },
    createdAt: Date.now(),
    updatedAt: Date.now()
  })
  close()
}

function close(): void {
  open.value = false
  query.value = ''
  results.value = []
  searched.value = false
  manualId.value = ''
  manualName.value = ''
  searchError.value = ''
}
</script>

<template>
  <UiDialog v-model:open="open" :title="t(pickOnly ? 'tpl.searchBgmId' : 'tpl.addAnimeTemplate')">
    <div class="flex flex-col gap-4">
      <!-- Bangumi 搜索 -->
      <div class="flex gap-2">
        <UiInput v-model="query" data-probe="bgm-search-query" :placeholder="t('tpl.searchPlaceholder')" @keydown.enter="search" />
        <UiButton variant="secondary" :disabled="searching" @click="search">
          <Loader2 v-if="searching" class="h-4 w-4 animate-spin" />
          <Search v-else class="h-4 w-4" />
        </UiButton>
      </div>

      <div class="max-h-64 overflow-x-hidden overflow-y-auto rounded-md border">
        <div v-if="!searched && results.length === 0" class="p-4 text-center text-xs text-muted-foreground">
          {{ t('tpl.searchEmpty') }}
        </div>
        <button
          v-for="item in results"
          :key="item.bgmId"
          class="flex w-full cursor-pointer items-start gap-3 border-b px-3 py-2 text-left last:border-b-0 hover:bg-accent"
          :disabled="creatingId !== null"
          @click="void createFromSearch(item)"
        >
          <img v-if="item.image" :src="item.image" class="h-10 w-10 shrink-0 rounded object-cover" loading="lazy" />
          <!-- 长标题换行，不要横向滚动条 -->
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium break-words whitespace-normal">{{ item.nameCn || item.name }}</div>
            <div class="text-xs break-words whitespace-normal text-muted-foreground">
              {{ item.name }} · bgm:{{ item.bgmId }}
            <Loader2 v-if="creatingId === item.bgmId" class="mt-1 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
            </div>
          </div>
        </button>
        <div v-if="searchError" class="p-4 text-center text-xs text-destructive">{{ searchError }}</div>
        <div v-else-if="searched && results.length === 0" class="p-4 text-center text-xs text-muted-foreground">
          {{ t('common.empty') }}
        </div>
      </div>

      <UiSeparator v-if="!pickOnly" />

      <!-- 手动 bgmId -->
      <div v-if="!pickOnly" class="flex items-center gap-2">
        <UiInput v-model="manualId" :placeholder="t('tpl.manualBgmId')" class="flex-1" @keydown.enter="createFromManual" />
        <UiButton variant="outline" data-probe="add-anime-by-id" :disabled="!validManualId || creatingId !== null" @click="createFromManual">
          {{ t('common.add') }}
        </UiButton>
      </div>
      <div v-if="!pickOnly" class="flex items-center gap-2">
        <UiInput v-model="manualName" data-probe="manual-anime-name" :placeholder="t('tpl.manualName')" @keydown.enter="createFromName" />
        <UiButton variant="outline" data-probe="add-anime-by-name" :disabled="!manualName.trim() || creatingId !== null" @click="createFromName">{{ t('common.add') }}</UiButton>
      </div>
    </div>
  </UiDialog>
</template>
