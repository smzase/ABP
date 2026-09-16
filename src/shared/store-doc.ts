import { SUBTITLE_TYPES, type AnimeFilenameExample, type AppData, type Settings, type SubtitleType } from './types.ts'
import { DEFAULT_ACCENT } from './constants.ts'
import { DEFAULT_SUBTITLE_RULES } from './subtitle-detect.ts'

/**
 * 存储文档：默认值、清洗、合并。
 * 纯函数，方便在 node 里单测「默认值 / 往返 / 损坏回退 / 部分字段合并」。
 */

export function defaultSettings(): Settings {
  return {
    // 默认浅色（#fafafa）—— 深色是可选项，不是默认
    appearance: { mode: 'light', accent: DEFAULT_ACCENT },
    locale: 'zh-CN',
    proxy: { mode: 'system', type: 'HTTP', host: '127.0.0.1', port: 7890, username: '', password: '' },
    subtitleDetect: { rules: structuredClone(DEFAULT_SUBTITLE_RULES) },
    sidebarCollapsed: false
  }
}

export function defaultAppData(): AppData {
  return {
    version: 1,
    settings: defaultSettings(),
    groups: [],
    titleTemplates: [
      {
        id: 'default-title',
        name: '默认标题',
        template:
          '[{{groupName}}] {{titleZh}} / {{titleRomaji}} / {{titleNative}} - {{ep}} - [{{subtitleLangZh}}][{{codecBitDepth}} {{resolutionUpper}} {{audioCodec}}]{{versionSuffix}}'
      }
    ],
    descTemplates: [],
    animeTemplates: [],
    records: []
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function num(v: unknown, fallback: number | null = null): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function cleanFilenameExample(v: unknown): AnimeFilenameExample {
  const x = typeof v === 'string' ? { fileName: v } : isObj(v) ? v : {}
  const subtitle =
    x.subtitleType === 'EXTERNAL' || x.subtitleType === 'EMBEDDED' || x.subtitleType === 'INTERNAL' || x.subtitleType === 'NONE'
      ? x.subtitleType
      : null
  return {
    fileName: str(x.fileName),
    languages: strArr(x.languages),
    subtitleType: subtitle,
    resolution: str(x.resolution),
    format: str(x.format),
    codec: str(x.codec),
    bitDepth: str(x.bitDepth),
    audioCodec: str(x.audioCodec),
    source: str(x.source)
  }
}

/**
 * 把任意来源（可能损坏/缺字段）的 JSON 清洗成合法 AppData。
 * 缺什么补什么；坏什么扔什么。永不抛异常。
 */
export function sanitizeAppData(raw: unknown): AppData {
  const base = defaultAppData()
  if (!isObj(raw)) return base

  const r = raw as Record<string, unknown>
  const s = isObj(r.settings) ? r.settings : {}
  const appearance = isObj(s.appearance) ? s.appearance : {}
  const proxy = isObj(s.proxy) ? s.proxy : {}
  const detect = isObj(s.subtitleDetect) ? s.subtitleDetect : {}

  base.settings = {
    appearance: {
      mode: appearance.mode === 'dark' ? 'dark' : 'light',
      accent: str(appearance.accent, base.settings.appearance.accent)
    },
    locale: s.locale === 'zh-TW' || s.locale === 'en' ? s.locale : 'zh-CN',
    proxy: {
      mode: proxy.mode === 'direct' || proxy.mode === 'custom' ? proxy.mode : 'system',
      type: proxy.type === 'HTTPS' || proxy.type === 'SOCKS5' ? proxy.type : 'HTTP',
      host: str(proxy.host, '127.0.0.1'),
      port: num(proxy.port, 7890) ?? 7890,
      username: str(proxy.username),
      password: str(proxy.password)
    },
    subtitleDetect: {
      rules: Array.isArray(detect.rules)
        ? detect.rules
            .filter(isObj)
            .map((x) => ({
              word: str(x.word),
              langs: strArr(x.langs),
              type: (SUBTITLE_TYPES as readonly string[]).includes(x.type as string)
                ? (x.type as SubtitleType)
                : null
            }))
            .filter((x) => x.word.length > 0)
        : structuredClone(DEFAULT_SUBTITLE_RULES)
    },
    sidebarCollapsed: s.sidebarCollapsed === true
  }

  if (Array.isArray(r.groups)) {
    base.groups = r.groups.filter(isObj).map((g) => ({
      id: str(g.id) || crypto.randomUUID(),
      name: str(g.name, '未命名组'),
      apiKey: str(g.apiKey),
      slug: str(g.slug),
      scopes: strArr(g.scopes),
      status: str(g.status),
      lastCheckedAt: num(g.lastCheckedAt)
    }))
  }

  if (Array.isArray(r.titleTemplates)) {
    const list = r.titleTemplates.filter(isObj).map((t) => ({
      id: str(t.id) || crypto.randomUUID(),
      name: str(t.name, '未命名模板'),
      template: str(t.template)
    }))
    if (list.length > 0) base.titleTemplates = list
  }

  if (Array.isArray(r.descTemplates)) {
    base.descTemplates = r.descTemplates.filter(isObj).map((t) => ({
      id: str(t.id) || crypto.randomUUID(),
      name: str(t.name, '未命名简介'),
      markdown: str(t.markdown)
    }))
  }

  if (Array.isArray(r.animeTemplates)) {
    base.animeTemplates = r.animeTemplates.filter(isObj).map((a) => {
      const names = isObj(a.names) ? a.names : {}
      const tpls = isObj(a.titleTemplates) ? a.titleTemplates : {}
      return {
        id: str(a.id) || crypto.randomUUID(),
        bgmId: num(a.bgmId),
        names: {
          zh: str(names.zh),
          zhTw: str(names.zhTw),
          romaji: str(names.romaji),
          en: str(names.en),
          native: str(names.native)
        },
        groupId: str(a.groupId),
        nyaaProxy: a.nyaaProxy === true,
        traditionalizeTitle: a.traditionalizeTitle === true,
        // 留空就是留空：番剧模板新建时标题模板/简介都是空的，
        // 这里回填「第一条全局模板」的话，用户清空过的字段会在下次加载时自己长回来
        titleTemplates: {
          simp: str(tpls.simp),
          trad: str(tpls.trad),
          both: str(tpls.both)
        },
        descriptionMd: str(a.descriptionMd),
        filenameExamples: (() => {
          const examples = isObj(a.filenameExamples) ? a.filenameExamples : {}
          return {
            simpInternal: cleanFilenameExample(examples.simpInternal),
            tradInternal: cleanFilenameExample(examples.tradInternal),
            embedded: cleanFilenameExample(examples.embedded)
          }
        })(),
        createdAt: num(a.createdAt, Date.now()) ?? Date.now(),
        updatedAt: num(a.updatedAt, Date.now()) ?? Date.now()
      }
    })
  }

  if (Array.isArray(r.records)) {
    base.records = r.records.filter(isObj).map((x) => ({
      id: str(x.id) || crypto.randomUUID(),
      releaseId: str(x.releaseId),
      title: str(x.title),
      bgmId: num(x.bgmId),
      animeName: str(x.animeName),
      episodeKey: str(x.episodeKey),
      groupId: str(x.groupId),
      groupName: str(x.groupName),
      resolution: str(x.resolution),
      format: str(x.format),
      languages: strArr(x.languages),
      subtitle:
        x.subtitle === 'EXTERNAL' || x.subtitle === 'EMBEDDED' || x.subtitle === 'INTERNAL' || x.subtitle === 'NONE'
          ? x.subtitle
          : 'NONE',
      version: str(x.version, 'v1'),
      preview: x.preview === true,
      nyaa: x.nyaa === true,
      publishedAt: num(x.publishedAt, Date.now()) ?? Date.now(),
      status: x.status === 'deleted' || x.status === 'failed' ? x.status : 'ok',
      message: typeof x.message === 'string' ? x.message : undefined
    }))
  }

  return base
}
