<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Trash2, Languages, Loader2, AlertCircle, ChevronDown } from '@lucide/vue'
import { CollapsibleRoot, CollapsibleTrigger, CollapsibleContent } from 'reka-ui'
import { useAppStore } from '@renderer/stores/app.ts'
import UiInput from '@renderer/components/ui/UiInput.vue'
import UiLabel from '@renderer/components/ui/UiLabel.vue'
import UiButton from '@renderer/components/ui/UiButton.vue'
import UiSelect from '@renderer/components/ui/UiSelect.vue'
import UiSelectItem from '@renderer/components/ui/UiSelectItem.vue'
import UiSwitch from '@renderer/components/ui/UiSwitch.vue'
import UiCard from '@renderer/components/ui/UiCard.vue'
import UiTooltip from '@renderer/components/ui/UiTooltip.vue'
import { confirm } from '@renderer/lib/confirm.ts'
import { cn } from '@renderer/lib/utils.ts'
import { renderTemplate } from '@shared/template.ts'
import { RESOLUTIONS, SUBTITLE_TYPES, VIDEO_FORMATS } from '@shared/types.ts'
import { SUBTITLE_TYPE_I18N_KEY } from '@shared/constants.ts'
import LanguageMultiSelect from '@renderer/components/LanguageMultiSelect.vue'
import type { AnimeFilenameExample, LanguageCode, SubtitleType, TitleVariant } from '@shared/types.ts'

const UiMarkdownEditor = defineAsyncComponent(() => import('@renderer/components/ui/UiMarkdownEditor.vue'))

/**
 * 番剧模板编辑器，三块：
 * ① 信息：中/繁/英/罗马音/原名（可编辑）、繁体转换按钮（繁化姬）、bgmId（必填）、发布组（必选）、Nyaa 代发开关
 * ② 标题模板：简体 / 繁体 / 简繁 三个可单独编辑
 * ③ 简介：Markdown（md-editor-v3）
 */
const props = defineProps<{ id: string }>()
const { t } = useI18n()
const app = useAppStore()

const tpl = computed(() => app.data.animeTemplates.find((x) => x.id === props.id))

const converting = ref(false)
const convertError = ref('')

/**
 * bgmId 输入：**不要**把 store 里的数字回灌输入框。
 * 之前的写法是「输入 → Number() → 非法就写 null → getter 回吐空串」，
 * 于是任何一次非法中间态（前导 0、粘贴、打错一个字符）都会把整格清空 ——
 * 表现出来就是「能删、打不进去」。这里自己留一份原始文本，单向写进 store。
 *
 * 不做 store → 文本的反向同步：本组件被 :key="id" 钉住，切模板会整体重挂载，
 * 挂载时的初值已经足够；加反向 watch 反而会形成回灌环路，又把格子清空。
 */
const bgmIdText = ref(tpl.value?.bgmId != null ? String(tpl.value.bgmId) : '')
watch(bgmIdText, (v) => {
  if (!tpl.value) return
  const n = Number(v.trim())
  tpl.value.bgmId = v.trim() !== '' && Number.isInteger(n) && n > 0 ? n : null
  touch()
})

const mikanBangumiIdText = ref(tpl.value?.mikanBangumiId != null ? String(tpl.value.mikanBangumiId) : '')
watch(mikanBangumiIdText, (value) => {
  if (!tpl.value) return
  const parsed = Number(value.trim())
  tpl.value.mikanBangumiId = value.trim() !== '' && Number.isInteger(parsed) && parsed > 0 ? parsed : null
  touch()
})

const selectedGroup = computed(() => app.data.groups.find((group) => group.id === tpl.value?.groupId))
const needsBgmId = computed(() => app.data.settings.publishMode === 'anibt' || selectedGroup.value?.sites.anibt.enabled === true)
const needsMikanId = computed(() => app.data.settings.publishMode === 'local' && selectedGroup.value?.sites.mikan.enabled === true)
const missingBgmId = computed(() => needsBgmId.value && (tpl.value?.bgmId === null || tpl.value?.bgmId === undefined))
const missingMikanId = computed(() => needsMikanId.value && (tpl.value?.mikanBangumiId === null || tpl.value?.mikanBangumiId === undefined))
const missingGroup = computed(() => !tpl.value?.groupId)

function patchNames(key: 'zh' | 'zhTw' | 'romaji' | 'en' | 'native', v: string): void {
  if (!tpl.value) return
  tpl.value.names[key] = v
  touch()
}

function patchTitleTpl(variant: TitleVariant, v: string): void {
  if (!tpl.value) return
  tpl.value.titleTemplates[variant] = v
  touch()
}

function touch(): void {
  if (tpl.value) tpl.value.updatedAt = Date.now()
}
function setTraditionalize(v: boolean): void {
  if (!tpl.value) return
  tpl.value.traditionalizeTitle = v
  touch()
}

type FilenameExampleKey = 'simpInternal' | 'tradInternal' | 'embedded'

const EMPTY_EXAMPLE: AnimeFilenameExample = {
  fileName: '',
  languages: [],
  subtitleType: null,
  resolution: '',
  format: '',
  codec: '',
  bitDepth: '',
  audioCodec: '',
  source: ''
}

const EXAMPLE_ROWS: Array<{ key: FilenameExampleKey; labelKey: string }> = [
  { key: 'simpInternal', labelKey: 'tpl.exampleSimpInternal' },
  { key: 'tradInternal', labelKey: 'tpl.exampleTradInternal' },
  { key: 'embedded', labelKey: 'tpl.exampleEmbedded' }
]

const filenameExamplesOpen = ref(false)
const nyaaMoreOpen = ref(false)

function exampleValue(key: FilenameExampleKey): AnimeFilenameExample {
  return tpl.value?.filenameExamples?.[key] ?? EMPTY_EXAMPLE
}

function patchFilenameExample(key: FilenameExampleKey, patch: Partial<AnimeFilenameExample>): void {
  if (!tpl.value) return
  tpl.value.filenameExamples ??= {
    simpInternal: { ...EMPTY_EXAMPLE },
    tradInternal: { ...EMPTY_EXAMPLE },
    embedded: { ...EMPTY_EXAMPLE }
  }
  const current = tpl.value.filenameExamples[key] ?? EMPTY_EXAMPLE
  tpl.value.filenameExamples[key] = {
    ...current,
    ...patch,
    languages: patch.languages ? [...patch.languages] : [...current.languages]
  }
  touch()
}


/** 繁化姬：中文名 → 繁体中文名 */
async function convertTw(): Promise<void> {
  if (!tpl.value || !tpl.value.names.zh.trim()) return
  converting.value = true
  convertError.value = ''
  try {
    const res = await window.api.zhconvertTraditional(tpl.value.names.zh.trim())
    if (res.ok && res.data) {
      tpl.value.names.zhTw = res.data
      touch()
    } else {
      convertError.value = res.error ?? 'failed'
    }
  } finally {
    converting.value = false
  }
}

const TITLE_VARIANTS: Array<{ key: TitleVariant; labelKey: string }> = [
  { key: 'simp', labelKey: 'tpl.variantSimp' },
  { key: 'trad', labelKey: 'tpl.variantTrad' },
  { key: 'both', labelKey: 'tpl.variantBoth' }
]
const activeVariant = ref<TitleVariant>('simp')

/**
 * 套用全局模板：番剧模板不存「引用了哪条模板」，而是比内容。
 * 当前文本和某条全局模板一字不差 → 下拉显示那条；否则就是「自定义」。
 * 这样用户套用之后随手改一个字，状态自己就翻成自定义，
 * 不用额外维护一个会和内容打架的引用字段（模板内容改了，引用就成了谎话）。
 *
 * 空内容返回空串 —— reka-ui 把空串当「未选中」，于是新建的番剧模板显示占位文案
 * 「套用标题模板」，而不是一上来就宣称自己是「自定义」。
 */
const CUSTOM = '__custom__'

const desc = computed({
  get: () => tpl.value?.descriptionMd ?? '',
  set: (v: string) => {
    if (!tpl.value) return
    tpl.value.descriptionMd = v
    touch()
  }
})

const titleTplValue = computed(() => {
  const cur = tpl.value?.titleTemplates[activeVariant.value] ?? ''
  if (!cur) return ''
  return app.data.titleTemplates.find((x) => x.template === cur)?.id ?? CUSTOM
})

const descTplValue = computed(() => {
  const cur = tpl.value?.descriptionMd ?? ''
  if (!cur) return ''
  return app.data.descTemplates.find((x) => x.markdown === cur)?.id ?? CUSTOM
})

function applyTitleTpl(id: string): void {
  if (id === CUSTOM || !id) return
  const src = app.data.titleTemplates.find((x) => x.id === id)
  if (src) patchTitleTpl(activeVariant.value, src.template)
}

function applyDescTpl(id: string): void {
  if (id === CUSTOM || !id) return
  const src = app.data.descTemplates.find((x) => x.id === id)
  if (src) desc.value = src.markdown
}

/**
 * 标题预览：用**这个番剧自己的**名字和发布组渲染，其余（集数/分辨率/编码…）用示例值。
 * 语言按当前变体给：简体变体就是 CHS，繁体 CHT，简繁 CHS+CHT ——
 * 和发布时 pickTitleVariant 的判定对得上，所见即所得。
 */
const SAMPLE_LANGS: Record<TitleVariant, LanguageCode[]> = {
  simp: ['CHS'],
  trad: ['CHT'],
  both: ['CHS', 'CHT']
}

const titlePreview = computed(() => {
  if (!tpl.value) return ''
  const group = app.data.groups.find((g) => g.id === tpl.value?.groupId)
  const names = tpl.value.names
  const useTw = activeVariant.value === 'trad' && tpl.value.traditionalizeTitle
  return renderTemplate(tpl.value.titleTemplates[activeVariant.value], {
    groupName: group?.name || t('tpl.publishGroup'),
    titleZh: useTw && names.zhTw ? names.zhTw : names.zh,
    titleZhHans: names.zh,
    titleZhHant: names.zhTw,
    titleRomaji: names.romaji,
    titleEn: names.en,
    titleNative: names.native,
    traditionalizeTitle: useTw,
    ep: '8',
    version: 'v1',
    resolution: '1080p',
    dimensions: '1920x1080',
    format: 'MKV',
    codec: 'HEVC',
    bitDepth: '10bit',
    audioCodec: 'AAC',
    source: 'WEB-DL',
    customTags: [],
    languages: [...SAMPLE_LANGS[activeVariant.value], 'JP'],
    subtitleType: 'EMBEDDED'
  })
})

async function remove(): Promise<void> {
  if (!(await confirm({ title: t('tpl.deleteConfirm'), destructive: true }))) return
  const idx = app.data.animeTemplates.findIndex((x) => x.id === props.id)
  if (idx >= 0) app.data.animeTemplates.splice(idx, 1)
}
</script>

<template>
  <div v-if="tpl" class="flex min-w-0 flex-col gap-4 p-4">
    <!-- ① 信息 -->
    <UiCard class="p-4">
      <div class="mb-3 flex items-center justify-between gap-3">
        <h3 class="font-medium">{{ t('tpl.info') }}</h3>
        <div class="ml-auto flex items-center gap-2">
          <UiSelect
            :model-value="tpl.groupId"
            class="w-56"
            :class="cn(missingGroup && 'border-destructive')"
            :placeholder="t('tpl.needGroup')"
            @update:model-value="(v: string) => { if (tpl) { tpl.groupId = v; touch() } }"
          >
            <UiSelectItem v-for="g in app.data.groups" :key="g.id" :value="g.id">{{ g.name }}</UiSelectItem>
            <div v-if="app.data.groups.length === 0" class="px-2 py-1.5 text-xs text-muted-foreground">{{ t('common.empty') }}</div>
          </UiSelect>
          <UiButton variant="destructive" size="sm" @click="remove"><Trash2 class="h-3.5 w-3.5" /> {{ t('common.delete') }}</UiButton>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div class="flex flex-col gap-1.5">
          <UiLabel>{{ t('tpl.bgmId') }} <template v-if="needsBgmId">*</template></UiLabel>
          <div class="relative">
            <UiInput v-model="bgmIdText" :class="cn(missingBgmId && 'border-destructive')" placeholder="400602" />
            <UiTooltip v-if="missingBgmId" :content="t('tpl.needBgmId')">
              <AlertCircle class="absolute right-2.5 top-2.5 h-4 w-4 text-destructive" />
            </UiTooltip>
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          <UiLabel>{{ t('tpl.mikanBangumiId') }} <template v-if="needsMikanId">*</template></UiLabel>
          <div class="relative">
            <UiInput v-model="mikanBangumiIdText" :class="cn(missingMikanId && 'border-destructive')" placeholder="3599" />
            <UiTooltip v-if="missingMikanId" :content="t('tpl.needMikanBangumiId')">
              <AlertCircle class="absolute right-2.5 top-2.5 h-4 w-4 text-destructive" />
            </UiTooltip>
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          <UiLabel>{{ t('tpl.nameZh') }}</UiLabel>
          <UiInput :model-value="tpl.names.zh" @update:model-value="(v: string) => patchNames('zh', v)" />
        </div>

        <div class="flex flex-col gap-1.5">
          <UiLabel>{{ t('tpl.nameZhTw') }}</UiLabel>
          <div class="flex gap-1.5">
            <UiInput
              class="min-w-0 flex-1"
              :model-value="tpl.names.zhTw"
              @update:model-value="(v: string) => patchNames('zhTw', v)"
            />
            <!-- 繁化姬一键转换：带文字标签，别只给个图标让人找不着 -->
            <UiTooltip :content="t('tpl.convertTwHint')">
              <UiButton
                variant="outline"
                class="shrink-0"
                :disabled="converting || !tpl.names.zh.trim()"
                @click="convertTw"
              >
                <Loader2 v-if="converting" class="h-4 w-4 animate-spin" />
                <Languages v-else class="h-4 w-4" />
                {{ t('tpl.convertTw') }}
              </UiButton>
            </UiTooltip>
          </div>
          <span v-if="convertError" class="text-xs text-destructive">{{ convertError }}</span>
        </div>

        <div class="flex flex-col gap-1.5">
          <UiLabel>{{ t('tpl.nameRomaji') }}</UiLabel>
          <UiInput :model-value="tpl.names.romaji" @update:model-value="(v: string) => patchNames('romaji', v)" />
        </div>

        <div class="flex flex-col gap-1.5">
          <UiLabel>{{ t('tpl.nameEn') }}</UiLabel>
          <UiInput :model-value="tpl.names.en" @update:model-value="(v: string) => patchNames('en', v)" />
        </div>

        <div class="flex flex-col gap-1.5">
          <UiLabel>{{ t('tpl.nameNative') }}</UiLabel>
          <UiInput :model-value="tpl.names.native" @update:model-value="(v: string) => patchNames('native', v)" />
        </div>
</div>

      <!-- Nyaa 代发与更多项固定在未展开的第一行。 -->
      <CollapsibleRoot v-model:open="nyaaMoreOpen" class="mt-3 w-full" data-probe="nyaa-more">
        <div class="flex items-center justify-end gap-2">
          <UiTooltip :content="t('tpl.nyaaProxyHint')">
            <label class="flex w-fit cursor-pointer items-center gap-2 text-sm" data-probe="nyaa-proxy-fixed">
              <UiSwitch
                :model-value="tpl.nyaaProxy"
                @update:model-value="(v: boolean) => { if (tpl) { tpl.nyaaProxy = v; touch() } }"
              />
              {{ t('tpl.nyaaProxy') }}
            </label>
          </UiTooltip>
          <CollapsibleTrigger
            class="flex w-fit cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-accent [&[data-state=open]>svg]:rotate-180"
            data-probe="nyaa-more-trigger"
          >
            <ChevronDown class="h-4 w-4 shrink-0 transition-transform" />
            {{ t('tpl.nyaaMore') }}
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent
          class="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down"
        >
          <div class="mt-2 flex flex-col gap-2 rounded-md border bg-muted/20 p-3">
            <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
              <div class="flex flex-col gap-1.5"><UiLabel>Information</UiLabel><UiInput v-model="tpl.nyaaInformation" /></div>
              <label class="flex cursor-pointer items-center gap-2 self-end pb-2 text-sm" data-probe="nyaa-hidden">
                <UiSwitch v-model="tpl.nyaaHidden" />{{ t('tpl.hiddenTorrent') }}
              </label>
              <UiTooltip :content="t('tpl.remakeHint')">
                <label class="flex cursor-pointer items-center gap-2 self-end pb-2 text-sm" data-probe="nyaa-remake">
                  <UiSwitch v-model="tpl.nyaaRemake" />{{ t('tpl.remakeTorrent') }}
                </label>
              </UiTooltip>
            </div>
            <p class="text-left text-xs text-muted-foreground" data-probe="nyaa-local-only-note">
              {{ t('tpl.nyaaLocalOnlyNote') }}
            </p>
          </div>
        </CollapsibleContent>
      </CollapsibleRoot>

      <!-- 种子名示例下移为独立的一整排。 -->
      <CollapsibleRoot v-model:open="filenameExamplesOpen" class="mt-2 w-full" data-probe="filename-examples">
        <div class="flex justify-end" data-probe="filename-examples-header">
          <CollapsibleTrigger class="flex w-fit cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-accent [&[data-state=open]>svg]:rotate-180" data-probe="filename-examples-trigger">
            <ChevronDown class="h-4 w-4 shrink-0 transition-transform" />{{ t('tpl.filenameExamples') }}
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent class="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down" data-probe="filename-examples-content">
          <div class="px-2 py-1">
            <div class="flex flex-col gap-4">
              <div
                v-for="row in EXAMPLE_ROWS"
                :key="row.key"
                :data-example-row="row.key"
                class="flex flex-col gap-2 border-b pb-4 last:border-b-0 last:pb-0"
              >
                <UiLabel>{{ t(row.labelKey) }}</UiLabel>
                <!-- 文件名始终独占一整行，避免和元数据控件挤在一起。 -->
                <UiInput
                  :model-value="exampleValue(row.key).fileName"
                  class="w-full"
                  data-example-filename
                  :placeholder="t('tpl.examplePlaceholder')"
                  @update:model-value="(v: string) => patchFilenameExample(row.key, { fileName: v })"
                />

                <!-- 八个发布元数据在文件名下方统一排列。 -->
                <div class="overflow-x-auto">
                  <div class="grid min-w-[960px] grid-cols-8 gap-2" data-example-metadata>
                  <div class="flex min-w-0 flex-col gap-1.5">
                    <UiLabel class="text-xs">{{ t('publish.subtitleLang') }}</UiLabel>
                    <LanguageMultiSelect
                      :model-value="exampleValue(row.key).languages"
                      @update:model-value="(v: string[]) => patchFilenameExample(row.key, { languages: v })"
                    />
                  </div>
                  <div class="flex min-w-0 flex-col gap-1.5">
                    <UiLabel class="text-xs">{{ t('publish.subtitleType') }}</UiLabel>
                    <UiSelect
                      :model-value="exampleValue(row.key).subtitleType ?? ''"
                      :placeholder="t('settings.noneDetected')"
                      @update:model-value="(v: string) => patchFilenameExample(row.key, { subtitleType: v as SubtitleType })"
                    >
                      <UiSelectItem v-for="s in SUBTITLE_TYPES" :key="s" :value="s">
                        {{ t(SUBTITLE_TYPE_I18N_KEY[s]) }}
                      </UiSelectItem>
                    </UiSelect>
                  </div>
                  <div class="flex min-w-0 flex-col gap-1.5">
                    <UiLabel class="text-xs">{{ t('publish.format') }}</UiLabel>
                    <UiSelect
                      :model-value="exampleValue(row.key).format"
                      :placeholder="t('publish.format')"
                      @update:model-value="(v: string) => patchFilenameExample(row.key, { format: v })"
                    >
                      <UiSelectItem v-for="f in VIDEO_FORMATS" :key="f" :value="f">{{ f }}</UiSelectItem>
                    </UiSelect>
                  </div>
                  <div class="flex min-w-0 flex-col gap-1.5">
                    <UiLabel class="text-xs">{{ t('publish.resolution') }}</UiLabel>
                    <UiSelect
                      :model-value="exampleValue(row.key).resolution"
                      :placeholder="t('publish.resolution')"
                      @update:model-value="(v: string) => patchFilenameExample(row.key, { resolution: v })"
                    >
                      <UiSelectItem v-for="r in RESOLUTIONS" :key="r" :value="r">{{ r }}</UiSelectItem>
                    </UiSelect>
                  </div>
                  <div class="flex min-w-0 flex-col gap-1.5">
                    <UiLabel class="text-xs">{{ t('tpl.exampleCodec') }}</UiLabel>
                    <UiInput
                      :model-value="exampleValue(row.key).codec"
                      :placeholder="t('tpl.exampleCodec')"
                      @update:model-value="(v: string) => patchFilenameExample(row.key, { codec: v })"
                    />
                  </div>
                  <div class="flex min-w-0 flex-col gap-1.5">
                    <UiLabel class="text-xs">{{ t('tpl.exampleBitDepth') }}</UiLabel>
                    <UiInput
                      :model-value="exampleValue(row.key).bitDepth"
                      :placeholder="t('tpl.exampleBitDepth')"
                      @update:model-value="(v: string) => patchFilenameExample(row.key, { bitDepth: v })"
                    />
                  </div>
                  <div class="flex min-w-0 flex-col gap-1.5">
                    <UiLabel class="text-xs">{{ t('tpl.exampleAudioCodec') }}</UiLabel>
                    <UiInput
                      :model-value="exampleValue(row.key).audioCodec"
                      :placeholder="t('tpl.exampleAudioCodec')"
                      @update:model-value="(v: string) => patchFilenameExample(row.key, { audioCodec: v })"
                    />
                  </div>
                  <div class="flex min-w-0 flex-col gap-1.5">
                    <UiLabel class="text-xs">{{ t('tpl.exampleSource') }}</UiLabel>
                    <UiInput
                      :model-value="exampleValue(row.key).source"
                      :placeholder="t('tpl.exampleSource')"
                      @update:model-value="(v: string) => patchFilenameExample(row.key, { source: v })"
                    />
                  </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </CollapsibleRoot>
    </UiCard>

    <!-- ② 标题模板（简/繁/简繁） -->
    <UiCard class="p-4">
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <h3 class="font-medium">{{ t('tpl.titleTpl') }}</h3>
        <div class="flex items-center gap-1 rounded-lg bg-secondary p-0.5">
          <button
            v-for="v in TITLE_VARIANTS"
            :key="v.key"
            class="cursor-pointer rounded-md px-2.5 py-1 text-xs transition-colors"
            :class="cn(activeVariant === v.key ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground')"
            @click="activeVariant = v.key"
          >
            {{ t(v.labelKey) }}
          </button>
        </div>
        <!-- 传统标题变体可单独开启繁化；开关放在模板选择左侧 -->
        <UiTooltip v-if="activeVariant === 'trad'" :content="t('tpl.titleTraditionalizeHint')">
          <label class="flex cursor-pointer items-center gap-1.5 text-xs">
            <UiSwitch
              :model-value="tpl.traditionalizeTitle"
              @update:model-value="setTraditionalize"
            />
            {{ t('tpl.titleTraditionalize') }}
          </label>
        </UiTooltip>
        <!-- 套用全局标题模板；改过内容就自动显示「自定义」 -->
        <UiSelect
          class="ml-auto h-8 w-56"
          :model-value="titleTplValue"
          :placeholder="t('tpl.useTitleTpl')"
          @update:model-value="applyTitleTpl"
        >
          <UiSelectItem v-for="x in app.data.titleTemplates" :key="x.id" :value="x.id">{{ x.name }}</UiSelectItem>
          <UiSelectItem v-if="titleTplValue === CUSTOM" :value="CUSTOM">{{ t('tpl.customTpl') }}</UiSelectItem>
          <div v-if="app.data.titleTemplates.length === 0" class="px-2 py-1.5 text-xs text-muted-foreground">
            {{ t('tpl.noTplAvailable') }}
          </div>
        </UiSelect>
      </div>
      <!-- 预览在输入框上方：改模板时眼睛不用来回跳 -->
      <div class="mb-2 flex flex-col gap-1">
        <UiLabel class="text-xs text-muted-foreground">{{ t('tpl.preview') }}</UiLabel>
        <div class="min-h-9 rounded-md border bg-muted/50 px-3 py-2 text-sm break-all">
          <span v-if="titlePreview">{{ titlePreview }}</span>
          <span v-else class="text-muted-foreground">—</span>
        </div>
      </div>
      <textarea
        :value="tpl.titleTemplates[activeVariant]"
        rows="3"
        class="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm leading-relaxed break-all whitespace-pre-wrap shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        spellcheck="false"
        @input="(e: Event) => patchTitleTpl(activeVariant, (e.target as HTMLTextAreaElement).value)"
      />
      <p v-if="titleTplValue === CUSTOM" class="mt-1.5 text-xs text-muted-foreground">
        {{ t('tpl.customTplHint') }}
      </p>
    </UiCard>

    <!-- ③ 简介 -->
    <UiCard class="flex min-w-0 flex-col p-4">
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <h3 class="font-medium">{{ t('tpl.desc') }}</h3>
        <UiSelect
          class="ml-auto h-8 w-56"
          :model-value="descTplValue"
          :placeholder="t('tpl.useDescTpl')"
          @update:model-value="applyDescTpl"
        >
          <UiSelectItem v-for="x in app.data.descTemplates" :key="x.id" :value="x.id">{{ x.name }}</UiSelectItem>
          <UiSelectItem v-if="descTplValue === CUSTOM" :value="CUSTOM">{{ t('tpl.customTpl') }}</UiSelectItem>
          <div v-if="app.data.descTemplates.length === 0" class="px-2 py-1.5 text-xs text-muted-foreground">
            {{ t('tpl.noTplAvailable') }}
          </div>
        </UiSelect>
      </div>
      <UiMarkdownEditor v-model="desc" style="height: max(min(68vh, 720px), 420px)" />
    </UiCard>
  </div>
</template>
