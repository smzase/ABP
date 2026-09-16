<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search, Loader2 } from '@lucide/vue'
import type { BgmSearchItem } from '@shared/types.ts'
import { useAppStore } from '@renderer/stores/app.ts'
import { genId } from '@renderer/lib/utils.ts'
import UiDialog from '@renderer/components/ui/UiDialog.vue'
import UiInput from '@renderer/components/ui/UiInput.vue'
import UiButton from '@renderer/components/ui/UiButton.vue'
import UiSeparator from '@renderer/components/ui/UiSeparator.vue'

/**
 * 添加番剧模板入口：Bangumi 搜索 或 手动输入 bgmId，选好才创建模板。
 */
const open = defineModel<boolean>('open', { default: false })
const { t } = useI18n()
const app = useAppStore()

const query = ref('')
const searching = ref(false)
const results = ref<BgmSearchItem[]>([])
const searched = ref(false)
const manualId = ref('')
const creatingId = ref<number | null>(null)

function emptyFilenameExample() {
  return { fileName: '', languages: [], subtitleType: null, resolution: '', format: '', codec: '', bitDepth: '', audioCodec: '', source: '',  }
}

let debounce: ReturnType<typeof setTimeout> | null = null
watch(query, () => {
  if (debounce) clearTimeout(debounce)
  if (!query.value.trim()) {
    results.value = []
    searched.value = false
    return
  }
  debounce = setTimeout(() => void search(), 350)
})

async function search(): Promise<void> {
  const q = query.value.trim()
  if (!q) return
  searching.value = true
  try {
    const res = await window.api.anibtBgmSearch(q, 10)
    results.value = res.ok ? (res.data ?? []) : []
    searched.value = true
  } finally {
    searching.value = false
  }
}

/**
 * 新建番剧模板：标题模板与简介一律留空。
 * 不预填第一条全局模板 —— 那会让人以为「已经配好了」，发布时才发现套的是别的番的模板。
 * 要用全局模板就在编辑器里显式选一个（选完还能改，改了就算「自定义」）。
 */
async function createFromSearch(item: BgmSearchItem): Promise<void> {
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
    app.data.animeTemplates.push({
      id: genId(),
      bgmId: item.bgmId,
      names: {
        zh: names.nameCn || item.nameCn || '',
        zhTw: '',
        romaji: names.romaji || '',
        en: names.en || '',
        native: names.name || item.name || ''
      },
      groupId: '',
      nyaaProxy: false,
      traditionalizeTitle: false,
      titleTemplates: { simp: '', trad: '', both: '' },
      descriptionMd: '',
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
  if (!Number.isInteger(id) || id <= 0) return
  app.data.animeTemplates.push({
    id: genId(),
    bgmId: id,
    names: { zh: '', zhTw: '', romaji: '', en: '', native: '' },
    groupId: '',
    nyaaProxy: false,
    traditionalizeTitle: false,
    titleTemplates: { simp: '', trad: '', both: '' },
    descriptionMd: '',
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
}
</script>

<template>
  <UiDialog v-model:open="open" :title="t('tpl.addAnimeTemplate')">
    <div class="flex flex-col gap-4">
      <!-- Bangumi 搜索 -->
      <div class="flex gap-2">
        <UiInput v-model="query" :placeholder="t('tpl.searchPlaceholder')" @keydown.enter="search" />
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
        <div v-if="searched && results.length === 0" class="p-4 text-center text-xs text-muted-foreground">
          {{ t('common.empty') }}
        </div>
      </div>

      <UiSeparator />

      <!-- 手动 bgmId -->
      <div class="flex items-center gap-2">
        <UiInput v-model="manualId" :placeholder="t('tpl.manualBgmId')" class="flex-1" @keydown.enter="createFromManual" />
        <UiButton variant="outline" :disabled="!manualId.trim()" @click="createFromManual">
          {{ t('common.add') }}
        </UiButton>
      </div>
    </div>
  </UiDialog>
</template>
