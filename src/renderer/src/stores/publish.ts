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
import { parseFileName } from '@shared/parse-name.ts'
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
import { enabledSites, isSiteConfigured } from '@shared/sites.ts'

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
    // 主进程不知道用户自定义词库，也不知道匹配到的番剧标题。渲染层在模板匹配后
    // 重跑一次：既应用当前词库，也先屏蔽标题别名，避免 86/100/365 被当成集数。
    const parsed = parseFileName(
      meta.innerName || meta.fileName,
      rules,
      matchedTemplate ? Object.values(matchedTemplate.names) : []
    )
    const p = applyFilenameExample(parsed, matchedTemplate?.filenameExamples, rules)
    const detectedLanguages = [...p.languages]
    const subtitleType = inferSubtitleType(p.format, detectedLanguages, p.subtitleType)
    const languages = subtitleType === 'NONE' ? [] : detectedLanguages
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
      customTags: [...(matchedTemplate?.customTags ?? [])],
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

  /**
   * 更新会参与标题模板的字段时同步重渲染标题。
   * 仅当当前标题仍等于旧字段生成的标题时才联动；用户手工改过标题后不覆盖。
   */
  function patchEntryAndSyncTitle(id: string, patch: Partial<PublishEntry>): void {
    const idx = entries.value.findIndex((entry) => entry.id === id)
    if (idx < 0) return
    const current = entries.value[idx]
    const titleWasGenerated = current.title === renderEntryTitle(current)
    const next = { ...current, ...patch }
    if (next.subtitleType === 'NONE') next.languages = []
    if (titleWasGenerated) next.title = renderEntryTitle(next)
    entries.value[idx] = next
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
    entry.languages = entry.subtitleType === 'NONE' ? [] : [...parsed.languages]
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
    entry.customTags = [...tpl.customTags]
    applyProfileToEntry(entry, tpl)
    entry.title = renderEntryTitle(entry)
    if (!entry.description) entry.description = tpl.descriptionMd
  }

  const canGoFinal = computed(() =>
    entries.value.length > 0 && entries.value.every((entry) => {
      const template = templateOf(entry)
      if (!template) return false
      const group = app.data.groups.find((item) => item.id === template.groupId)
      if (!group) return false
      if (app.data.settings.publishMode === 'anibt') return template.bgmId !== null
      const sites = enabledSites(group)
      if (sites.length === 0) return false
      if (sites.includes('anibt') && template.bgmId === null) return false
      if (sites.includes('mikan') && template.mikanBangumiId === null) return false
      return true
    })
  )

  /** 发布中：由条目自身推导，切页面回来也不会丢状态 */
  const publishing = computed(() => entries.value.some((e) => e.publishing))

  /** 批量发布（串行，避免触发限流） */
  async function publishAll(opts: BatchOptions = batch.value): Promise<void> {
    const mode = app.data.settings.publishMode
    if (mode === 'local') {
      try {
        // local:publish 在主进程读取账号配置。显式同步一次，避免用户刚改 Token
        // 就点发布时，500ms 自动保存尚未触发而读到旧配置。
        await window.api.saveStore(toPlain(app.data))
      } catch (error) {
        for (const entry of entries.value.filter((item) => item.publishOk !== true)) {
          entry.publishOk = false
          entry.publishMessage = `保存站点配置失败：${String(error)}`
        }
        return
      }
    }
    for (const entry of entries.value) {
      if (entry.publishOk === true) continue
      const tpl = templateOf(entry)
      if (!tpl) {
        entry.publishOk = false
        entry.publishMessage = '未选择番剧模板'
        continue
      }
      const group = app.data.groups.find((g) => g.id === tpl.groupId)
      if (!group) {
        entry.publishOk = false
        entry.publishMessage = '未选择发布组'
        continue
      }

      const localSites = enabledSites(group)
      if ((mode === 'anibt' || localSites.includes('anibt')) && tpl.bgmId === null) {
        entry.publishOk = false
        entry.publishMessage = '启用 AniBT 发布时，模板必须填写 bgmId'
        continue
      }
      if (mode === 'local' && localSites.includes('mikan') && tpl.mikanBangumiId === null) {
        entry.publishOk = false
        entry.publishMessage = '启用蜜柑计划发布时，模板必须填写 Mikan bangumiId'
        continue
      }
      if (mode === 'anibt' && !group.sites.anibt.apiKey) {
        entry.publishOk = false
        entry.publishMessage = '发布组未配置 AniBT API Key'
        continue
      }
      if (mode === 'local') {
        if (localSites.length === 0) {
          entry.publishOk = false
          entry.publishMessage = '发布组没有启用任何站点'
          continue
        }
        const missing = localSites.filter((site) => !isSiteConfigured(site, group.sites[site]))
        if (missing.length > 0) {
          entry.publishOk = false
          entry.publishMessage = `以下站点尚未完成账号配置：${missing.join(', ')}`
          continue
        }
      }

      // 发出去之前先本地体检：站点对不合法 body 只回一句「Invalid request body」，
      // 不点名字段。空标题、1440p 这种站点不认的分辨率，在这里就拦下来并说清楚是哪个字段。
      const problems = mode === 'anibt' || localSites.includes('anibt')
        ? validatePublishPayload({
            title: entry.title,
            resolution: entry.resolution,
            format: entry.format,
            subtitle: entry.subtitleType,
            language: entry.languages,
            notes: entry.description,
            nyaa: mode === 'anibt' && entry.nyaa,
            nyaaCategory: opts.nyaaCategory
          })
        : entry.title.trim()
          ? []
          : [{ key: 'publishCheck.titleRequired' }]
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
        const recordId = genId()
        let publishOk = false
        let releaseId = ''
        let previewUrl = ''
        let publishMessage = ''
        let siteResults: PublishRecord['siteResults'] = []
        if (mode === 'anibt') {
          const res = await window.api.anibtPublish(toPlain({
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
            apiKey: group.sites.anibt.apiKey
          }))
          publishOk = res.ok
          releaseId = res.releaseId ?? ''
          previewUrl = res.previewUrl ?? ''
          publishMessage = res.ok ? '' : (res.error?.message ?? '未知错误')
          siteResults = [{
            site: 'anibt',
            ok: res.ok,
            url: res.previewUrl,
            error: res.error?.message,
            httpStatus: res.error?.httpStatus
          }]
        } else {
          const res = await window.api.localPublish(toPlain({
            recordId,
            torrentToken: entry.torrentToken,
            torrentFileName: entry.fileName,
            groupId: group.id,
            sites: localSites,
            title: entry.title,
            episodeKey: entry.episode,
            resolution: entry.resolution,
            format: entry.format,
            subtitle: entry.subtitleType,
            language: entry.languages,
            version: entry.version || 'v1',
            descriptionMd: entry.description,
            bgmId: tpl.bgmId,
            mikanBangumiId: tpl.mikanBangumiId,
            nyaaCategory: opts.nyaaCategory,
            nyaaInformation: tpl.nyaaInformation,
            nyaaHidden: tpl.nyaaHidden,
            nyaaRemake: tpl.nyaaRemake
          }))
          publishOk = res.ok
          siteResults = res.sites
          publishMessage = res.ok
            ? ''
            : (res.sites.filter((item) => !item.ok).map((item) => `${item.site}: ${item.error ?? '失败'}`).join('；') || res.error || '未知错误')
        }
        entry.publishOk = publishOk
        entry.previewUrl = previewUrl
        entry.publishMessage = publishMessage
        if (siteResults.some((item) => item.ok)) learnEntryExample(entry, tpl)
        const record: PublishRecord = {
          id: recordId,
          releaseId,
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
          nyaa: mode === 'anibt' && entry.nyaa,
          publishedAt: Date.now(),
          status: publishOk ? 'ok' : 'failed',
          message: entry.publishMessage || undefined,
          mode,
          torrentFileName: entry.fileName,
          descriptionMd: entry.description,
          mikanBangumiId: tpl.mikanBangumiId,
          nyaaCategory: opts.nyaaCategory,
          nyaaInformation: tpl.nyaaInformation,
          nyaaHidden: tpl.nyaaHidden,
          nyaaRemake: tpl.nyaaRemake,
          siteResults
        }
        app.data.records.unshift(record)
        if (publishOk) {
          void window.api.removeTorrent(entry.torrentToken)
          if (mode === 'local') void window.api.removeLocalArchive(recordId)
        }
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
    patchEntryAndSyncTitle,
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
