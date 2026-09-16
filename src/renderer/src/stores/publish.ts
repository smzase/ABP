import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type {
  AnimeTemplate,
  LanguageCode,
  ParsedName,
  PublishRecord,
  SubtitleType,
  TorrentMeta
} from '@shared/types.ts'
import { renderTemplate, pickTitleVariant } from '@shared/template.ts'
import { toPlain } from '@shared/plain.ts'
import { validatePublishPayload, type PublishProblem } from '@shared/publish-validate.ts'
import { matchAnimeTemplateId } from '@shared/anime-match.ts'
import {
  applyFilenameExample,
  emptyFilenameExample,
  exampleKindForProfile,
  filenameExampleFromParsed,
  inferSubtitleType,
  learnFilenameExample
} from '@shared/torrent-profile.ts'
import { i18n } from '@renderer/i18n/index.ts'
import { genId } from '@renderer/lib/utils.ts'
import { useAppStore } from './app.ts'

/** 校验问题 → 人话。store 不在组件 setup 作用域里，直接用全局 i18n 实例（和 app store 一个路子） */
function translateProblem(p: PublishProblem): string {
  return i18n.global.t(p.key, p.params ?? {})
}

/** 发布队列条目（草稿，不落盘） */
export interface PublishEntry {
  id: string
  torrentToken: string
  fileName: string
  innerName: string
  hasNyaaTracker: boolean
  animeTemplateId: string
  title: string
  episode: string
  version: string
  resolution: string
  format: string
  subtitleType: SubtitleType
  languages: LanguageCode[]
  customTags: string[]
  description: string
  codec: string
  bitDepth: string
  audioCodec: string
  source: string
  expanded: boolean
  nyaa: boolean
  /** 发布结果 */
  publishing: boolean
  publishOk: boolean | null
  publishMessage: string
  previewUrl: string
}

export interface BatchOptions {
  preview: boolean
  nyaaCategory: string
}

export const usePublishStore = defineStore('publish', () => {
  const app = useAppStore()
  const entries = ref<PublishEntry[]>([])
  const stage = ref<'config' | 'final'>('config')

  /**
   * 批量选项放 store 而不是底栏组件里。
   * 放组件里的话，切到别的页面会把底栏卸载掉，`ref` 跟着归零 ——
   * 用户打开了「Preview 测试发布」，去别的页面转一圈回来，开关自己关了。
   * 队列本身就是靠 store 活过路由切换的，选项理应一起。
   */
  const batch = ref<BatchOptions>({ preview: false, nyaaCategory: '1_3' })

  const animeTemplates = computed(() => app.data.animeTemplates)

  /** 依据种子解析结果生成条目；自动匹配番剧模板（bgmId 匹配不到就留空让用户选） */
  function addTorrent(meta: TorrentMeta): PublishEntry {
    const rules = app.data.settings.subtitleDetect.rules
    const animeTemplateId = matchAnimeTemplateId(meta.fileName, meta.innerName, app.data.animeTemplates)
    const matchedTemplate = app.data.animeTemplates.find((tpl) => tpl.id === animeTemplateId)
    const p = applyFilenameExample(meta.parsed, matchedTemplate?.filenameExamples, rules)
    const languages = [...p.languages]
    const subtitleType = inferSubtitleType(p.format, languages, p.subtitleType)
    const entry: PublishEntry = {
      id: genId(),
      torrentToken: meta.token,
      fileName: meta.fileName,
      innerName: meta.innerName || meta.fileName,
      hasNyaaTracker: meta.hasNyaaTracker,
      animeTemplateId,
      title: '',
      episode: p.episode ?? '',
      version: p.version ?? 'v1',
      resolution: p.resolution ?? '1080p',
      format: p.format ?? 'MKV',
      subtitleType,
      languages,
      customTags: [],
      description: '',
      codec: p.codec ?? '',
      bitDepth: p.bitDepth ?? '',
      audioCodec: p.audioCodec ?? '',
      source: p.source ?? '',
      expanded: false,
      nyaa: matchedTemplate?.nyaaProxy ?? false,
      publishing: false,
      publishOk: null,
      publishMessage: '',
      previewUrl: ''
    }
    entries.value.push(entry)
    return entry
  }

  /**
   * 队列空了就退回第一步。
   * 阶段二（最终修改）把条目删光后还停在阶段二的话，页面上只剩一句「还没有添加种子」，
   * 投放区在阶段一，用户等于被卡在一个空页面上，只能手动点「上一步」。
   */
  function syncStage(): void {
    if (entries.value.length === 0) stage.value = 'config'
  }

  function removeEntry(id: string): void {
    const idx = entries.value.findIndex((e) => e.id === id)
    if (idx < 0) return
    void window.api.removeTorrent(entries.value[idx].torrentToken)
    entries.value.splice(idx, 1)
    syncStage()
  }

  function replaceEntry(next: PublishEntry): void {
    const idx = entries.value.findIndex((e) => e.id === next.id)
    if (idx >= 0) entries.value[idx] = next
  }

  function templateOf(entry: PublishEntry): AnimeTemplate | undefined {
    return app.data.animeTemplates.find((t) => t.id === entry.animeTemplateId)
  }

  /** 用番剧模板的标题模板渲染发布标题 */
  function renderEntryTitle(entry: PublishEntry): string {
    const tpl = templateOf(entry)
    if (!tpl) return entry.title
    const group = app.data.groups.find((g) => g.id === tpl.groupId)
    const variant = pickTitleVariant(entry.languages)
    const template = tpl.titleTemplates[variant]
    const useTw = variant === 'trad' && tpl.traditionalizeTitle
    return renderTemplate(template, {
      groupName: group?.name ?? '',
      // {{titleZh}} 跟着变体走：繁体变体用繁体名。
      // {{titleZhHans}}/{{titleZhHant}} 是模板作者明确指定的，不跟变体动
      titleZh: useTw && tpl.names.zhTw ? tpl.names.zhTw : tpl.names.zh,
      titleZhHans: tpl.names.zh,
      titleZhHant: tpl.names.zhTw,
      titleRomaji: tpl.names.romaji,
      titleEn: tpl.names.en,
      titleNative: tpl.names.native,
      traditionalizeTitle: useTw,
      ep: entry.episode,
      version: entry.version,
      resolution: entry.resolution,
      format: entry.format,
      codec: entry.codec,
      bitDepth: entry.bitDepth,
      audioCodec: entry.audioCodec,
      source: entry.source,
      customTags: entry.customTags,
      languages: entry.languages,
      subtitleType: entry.subtitleType
    })
  }

  /** 进入最终修改环节前，把所有空标题用模板渲染出来 */
  function fillTitlesFromTemplates(): void {
    for (const entry of entries.value) {
      if (!entry.title && entry.animeTemplateId) {
        entry.title = renderEntryTitle(entry)
      }
      if (!entry.description) {
        const tpl = templateOf(entry)
        if (tpl) entry.description = tpl.descriptionMd
      }
    }
  }

  function parsedFromEntry(entry: PublishEntry): ParsedName {
    return {
      episode: entry.episode || null,
      resolution: entry.resolution || null,
      codec: entry.codec || null,
      bitDepth: entry.bitDepth || null,
      audioCodec: entry.audioCodec || null,
      source: entry.source || null,
      format: entry.format || null,
      version: entry.version || null,
      languages: [...entry.languages],
      subtitleType: entry.subtitleType
    }
  }

  function applyProfileToEntry(entry: PublishEntry, tpl: AnimeTemplate): void {
    const parsed = applyFilenameExample(
      parsedFromEntry(entry),
      tpl.filenameExamples,
      app.data.settings.subtitleDetect.rules
    )
    entry.resolution = parsed.resolution ?? entry.resolution
    entry.format = parsed.format ?? entry.format
    entry.subtitleType = inferSubtitleType(parsed.format, parsed.languages, parsed.subtitleType)
    entry.languages = [...parsed.languages]
    entry.codec = parsed.codec ?? entry.codec
    entry.bitDepth = parsed.bitDepth ?? entry.bitDepth
    entry.audioCodec = parsed.audioCodec ?? entry.audioCodec
    entry.source = parsed.source ?? entry.source
    if (!entry.version && parsed.version) entry.version = parsed.version
  }

  function learnEntryExample(entry: PublishEntry, tpl: AnimeTemplate): void {
    const kind = exampleKindForProfile(parsedFromEntry(entry))
    if (!kind) return
    const examples = tpl.filenameExamples ?? {
      simpInternal: emptyFilenameExample(),
      tradInternal: emptyFilenameExample(),
      embedded: emptyFilenameExample()
    }
    const next = learnFilenameExample(examples, kind, filenameExampleFromParsed(entry.innerName, parsedFromEntry(entry)))
    if (next[kind] === examples[kind]) return
    tpl.filenameExamples = next
    tpl.updatedAt = Date.now()
  }

  /** 选中模板后联动：Nyaa 默认值、示例 profile、重渲染标题。 */
  function applyTemplate(entryId: string): void {
    const entry = entries.value.find((e) => e.id === entryId)
    if (!entry) return
    const tpl = templateOf(entry)
    if (!tpl) return
    entry.nyaa = tpl.nyaaProxy
    applyProfileToEntry(entry, tpl)
    entry.title = renderEntryTitle(entry)
    if (!entry.description) entry.description = tpl.descriptionMd
  }

  const canGoFinal = computed(
    () => entries.value.length > 0 && entries.value.every((e) => e.animeTemplateId !== '')
  )

  /** 发布中：由条目自身推导，切页面回来也不会丢状态 */
  const publishing = computed(() => entries.value.some((e) => e.publishing))

  /** 批量发布（串行，避免触发限流） */
  async function publishAll(opts: BatchOptions = batch.value): Promise<void> {
    for (const entry of entries.value) {
      if (entry.publishOk === true) continue
      const tpl = templateOf(entry)
      if (!tpl || tpl.bgmId === null) {
        entry.publishOk = false
        entry.publishMessage = '模板缺少 bgmId'
        continue
      }
      const group = app.data.groups.find((g) => g.id === tpl.groupId)
      if (!group || !group.apiKey) {
        entry.publishOk = false
        entry.publishMessage = '发布组未配置 API Key'
        continue
      }

      // 发出去之前先本地体检：站点对不合法 body 只回一句「Invalid request body」，
      // 不点名字段。空标题、1440p 这种站点不认的分辨率，在这里就拦下来并说清楚是哪个字段。
      const problems = validatePublishPayload({
        title: entry.title,
        resolution: entry.resolution,
        format: entry.format,
        subtitle: entry.subtitleType,
        language: entry.languages,
        notes: entry.description,
        nyaa: entry.nyaa,
        nyaaCategory: opts.nyaaCategory
      })
      if (problems.length > 0) {
        entry.publishOk = false
        entry.publishMessage = problems.map((p) => translateProblem(p)).join('；')
        continue
      }

      entry.publishing = true
      entry.publishOk = null
      entry.publishMessage = ''
      entry.previewUrl = ''
      try {
        // toPlain 不能省：entry.languages 是 store 里的响应式数组（Proxy），
        // 直接送进 IPC 会被结构化克隆拒绝 ——「An object could not be cloned.」，
        // 而且报错里看不出是哪个字段的锅。见 shared/plain.ts
        const res = await window.api.anibtPublish(
          toPlain({
            torrentToken: entry.torrentToken,
            animeIdType: 'bgm',
            animeId: String(tpl.bgmId),
            title: entry.title,
            episodeKey: entry.episode,
            resolution: entry.resolution,
            language: entry.languages,
            subtitle: entry.subtitleType,
            format: entry.format,
            version: entry.version || 'v1',
            notes: entry.description,
            preview: opts.preview,
            nyaa: entry.nyaa,
            nyaaCategory: opts.nyaaCategory,
            apiKey: group.apiKey
          })
        )
        entry.publishOk = res.ok
        entry.previewUrl = res.previewUrl ?? ''
        entry.publishMessage = res.ok ? '' : (res.error?.message ?? '未知错误')
        if (res.ok) learnEntryExample(entry, tpl)
        const record: PublishRecord = {
          id: genId(),
          releaseId: res.releaseId ?? '',
          title: entry.title,
          bgmId: tpl.bgmId,
          animeName: tpl.names.zh || tpl.names.native,
          episodeKey: entry.episode,
          groupId: group.id,
          groupName: group.name,
          resolution: entry.resolution,
          format: entry.format,
          languages: [...entry.languages],
          subtitle: entry.subtitleType,
          version: entry.version || 'v1',
          preview: opts.preview,
          nyaa: entry.nyaa,
          publishedAt: Date.now(),
          status: res.ok ? 'ok' : 'failed',
          message: res.ok ? undefined : res.error?.message
        }
        app.data.records.unshift(record)
        if (res.ok) void window.api.removeTorrent(entry.torrentToken)
      } catch (err) {
        entry.publishOk = false
        entry.publishMessage = String(err)
      } finally {
        entry.publishing = false
      }
    }
  }

  function clearFinished(): void {
    entries.value = entries.value.filter((e) => e.publishOk !== true)
    syncStage()
  }

  return {
    entries,
    stage,
    batch,
    animeTemplates,
    addTorrent,
    removeEntry,
    replaceEntry,
    templateOf,
    renderEntryTitle,
    fillTitlesFromTemplates,
    applyTemplate,
    canGoFinal,
    publishing,
    publishAll,
    clearFinished
  }
})
