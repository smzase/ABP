import {
  LANG_ZH,
  LANG_ZH_TRAD,
  SUBTITLE_TYPE_ZH,
  SUBTITLE_TYPE_ZH_TRAD,
  DEFAULT_VERSION,
  sortLanguages
} from './constants.ts'
import type { LanguageCode, SubtitleType } from './types.ts'

/**
 * 标题模板引擎：把 {{var}} 渲染成最终发布标题。
 * 纯函数，不依赖 Electron / DOM，可在 node 里直接单测。
 */

export interface TemplateContext {
  groupName?: string
  /**
   * {{titleZh}}：中文名。发布时**跟随标题变体** —— 繁体变体下这里就是繁体名。
   * 想要「明确的简体 / 明确的繁体」用下面两个。
   */
  titleZh?: string
  /** {{titleZhHans}}：简体中文名。省略时回落 titleZh */
  titleZhHans?: string
  /** {{titleZhHant}}：繁体中文名。省略或为空时回落简体 */
  titleZhHant?: string
  titleRomaji?: string
  titleEn?: string
  titleNative?: string
  /** 原始集数输入，如 "1" / "08" / "12.5" */
  ep?: string
  /** 版本，如 "v2"；空或 v1 时不显示后缀 */
  version?: string
  resolution?: string
  dimensions?: string
  format?: string
  codec?: string
  bitDepth?: string
  audioCodec?: string
  source?: string
  customTags?: string[]
  languages?: LanguageCode[]
  subtitleType?: SubtitleType | null
  /** 繁体标题变体的字形开关。关闭时仍可使用明确的 titleZhHant。 */
  traditionalizeTitle?: boolean
}

/** 集数补零："1" → "01"；"12.5" → "12.5" 的整数部分补零 → "12.5" 不补？约定：纯数字且 <10 才补 */
export function padEpisode(ep: string): string {
  const s = ep.trim()
  if (/^\d+$/.test(s) && s.length < 2) return s.padStart(2, '0')
  return s
}

/** 版本后缀标签：v1 不显示，v2 及以上显示 "[v2]" */
export function versionSuffix(version: string | undefined): string {
  const v = (version ?? '').trim()
  if (!v || v.toLowerCase() === DEFAULT_VERSION) return ''
  return `[${v}]`
}

/** CHS + JP → "CHS&JP"。顺序统一成 CHS/CHT/JP/EN，不会出现 "JP&CHS" */
export function languageCodeTag(languages: LanguageCode[]): string {
  return sortLanguages(languages).join('&')
}

/** CHS+CHT+JP + 内封 → "简繁日内封"（同样按 CHS/CHT/JP/EN 排序） */
export function subtitleLangZhTag(
  languages: LanguageCode[],
  type: SubtitleType | null | undefined,
  traditional = false
): string {
  const langNames = traditional ? LANG_ZH_TRAD : LANG_ZH
  const subtitleNames = traditional ? SUBTITLE_TYPE_ZH_TRAD : SUBTITLE_TYPE_ZH
  if (type === 'NONE') return subtitleNames.NONE
  const langs = sortLanguages(languages)
    .map((l) => langNames[l] ?? l)
    .join('')
  if (!type) return langs
  return langs + subtitleNames[type]
}

function codecBitDepth(codec: string | undefined, bitDepth: string | undefined): string {
  if (codec && bitDepth) return `${codec}-${bitDepth}`
  return codec ?? bitDepth ?? ''
}

/** 渲染模板。未知变量保留原样（方便排查），空值变量渲染为空串 */
export function renderTemplate(template: string, ctx: TemplateContext): string {
  const epRaw = (ctx.ep ?? '').trim()
  // titleZh 会跟着标题变体走（繁体变体下它就是繁体名），所以简体要单独给一份，
  // 否则繁体变体下 {{titleZhHans}} 会渲染出繁体名 —— 那就完全失去这个变量的意义了
  const zhHans = ctx.titleZhHans ?? ctx.titleZh ?? ''
  // 繁体名没填就回落简体：模板里写了 {{titleZhHant}} 却渲染出空标题，比字没转繁更糟
  const zhHant = (ctx.titleZhHant ?? '').trim() || zhHans
  const effectiveLanguages = ctx.subtitleType === 'NONE' ? [] : (ctx.languages ?? [])
  const values: Record<string, string> = {
    groupName: ctx.groupName ?? '',
    titleZh: ctx.titleZh ?? '',
    titleZhHans: zhHans,
    titleZhHant: zhHant,
    titleRomaji: ctx.titleRomaji ?? '',
    titleEn: ctx.titleEn ?? '',
    titleNative: ctx.titleNative ?? '',
    ep: epRaw ? padEpisode(epRaw) : '',
    epRaw,
    version: (ctx.version ?? '').trim() || DEFAULT_VERSION,
    versionSuffix: versionSuffix(ctx.version),
    resolution: ctx.resolution ?? '',
    resolutionUpper: (ctx.resolution ?? '').toUpperCase(),
    dimensions: ctx.dimensions ?? '',
    format: ctx.format ?? '',
    codec: ctx.codec ?? '',
    bitDepth: ctx.bitDepth ?? '',
    codecBitDepth: codecBitDepth(ctx.codec, ctx.bitDepth),
    audioCodec: ctx.audioCodec ?? '',
    source: ctx.source ?? '',
    customTags: (ctx.customTags ?? []).join(' '),
    languageCode: languageCodeTag(effectiveLanguages),
    subtitleLangZh: subtitleLangZhTag(effectiveLanguages, ctx.subtitleType, ctx.traditionalizeTitle === true)
  }
  // 变量名大小写不敏感：{{titlezhhans}} / {{TitleZhHans}} 都认。
  // 变量是手打进模板里的，为一个大小写让人对着「原样输出的 {{...}}」发愣不值当。
  const lower = new Map(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]))
  return template
    .replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (raw, name: string) => {
      if (Object.prototype.hasOwnProperty.call(values, name)) return values[name]
      const hit = lower.get(name.toLowerCase())
      return hit === undefined ? raw : hit
    })
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/** 根据字幕语言推断标题变体：同时含简+繁 → 简繁；仅繁 → 繁体；否则简体 */
export function pickTitleVariant(languages: LanguageCode[]): 'simp' | 'trad' | 'both' {
  const hasS = languages.includes('CHS')
  const hasT = languages.includes('CHT')
  if (hasS && hasT) return 'both'
  if (hasT && !hasS) return 'trad'
  return 'simp'
}

/** 模板变量说明（变量面板 / 悬停提示用） */
export interface TemplateVariable {
  name: string
  note: string
}

export interface TemplateVariableGroup {
  key: string
  labelKey: string
  vars: TemplateVariable[]
}

export const TEMPLATE_VARIABLE_GROUPS: TemplateVariableGroup[] = [
  {
    key: 'group',
    labelKey: 'tplVar.group',
    vars: [{ name: 'groupName', note: '组名' }]
  },
  {
    key: 'title',
    labelKey: 'tplVar.title',
    vars: [
      { name: 'titleZhHans', note: '中文名（简体）' },
      { name: 'titleZhHant', note: '中文名（繁体，未填则回落简体）' },
      { name: 'titleZh', note: '中文名（等同简体）' },
      { name: 'titleRomaji', note: '罗马音' },
      { name: 'titleEn', note: '英文名' },
      { name: 'titleNative', note: '作品原名（如日文）' }
    ]
  },
  {
    key: 'ep',
    labelKey: 'tplVar.ep',
    vars: [
      { name: 'ep', note: '集数（默认前补 0，如 1 → 01）' },
      { name: 'epRaw', note: '原始集数（不补 0）' },
      { name: 'version', note: '版本（默认 v1，v1 也会显示）' },
      { name: 'versionSuffix', note: '版本后缀标签（如 [v2]，v1 不显示）' }
    ]
  },
  {
    key: 'tags',
    labelKey: 'tplVar.tags',
    vars: [
      { name: 'resolution', note: '分辨率（小写 p，如 1080p）' },
      { name: 'resolutionUpper', note: '分辨率（大写 P，如 1080P）' },
      { name: 'dimensions', note: '像素尺寸（如 1920x1080）' },
      { name: 'format', note: '文件格式（MKV、MP4 等）' },
      { name: 'codec', note: '视频编码（AVC、HEVC、AV1 等）' },
      { name: 'bitDepth', note: '位深（8bit、10bit）' },
      { name: 'codecBitDepth', note: '视频编码+位深（HEVC-10bit 等）' },
      { name: 'audioCodec', note: '音频编码（AAC、FLAC、OPUS 等）' },
      { name: 'source', note: '片源（WEB-DL、WebRip、Blu-ray、BDRip 等）' },
      { name: 'customTags', note: '全部自定义标签（空格隔开）' }
    ]
  },
  {
    key: 'subtitle',
    labelKey: 'tplVar.subtitle',
    vars: [
      { name: 'languageCode', note: '语言代码标签（CHS&JP、CHS&CHT&JP …）' },
      { name: 'subtitleLangZh', note: '字幕语言+字幕类型（如 简繁日内封）' }
    ]
  }
]
