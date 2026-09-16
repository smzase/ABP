import type { LanguageCode, SubtitleType } from './types.ts'

/** 语言代码 → 中文短名（用于 {{subtitleLangZh}}，如 CHS+CHT+JP+内封 → 简繁日内封） */
export const LANG_ZH: Record<string, string> = {
  CHS: '简',
  CHT: '繁',
  JP: '日',
  EN: '英',
  KR: '韩',
  FR: '法'
}

/** 繁体标题变体使用的字幕语言短名。 */
export const LANG_ZH_TRAD: Record<string, string> = {
  CHS: '簡',
  CHT: '繁',
  JP: '日',
  EN: '英',
  KR: '韓',
  FR: '法'
}

/** 字幕类型 → 中文后缀 */
export const SUBTITLE_TYPE_ZH: Record<SubtitleType, string> = {
  EXTERNAL: '外挂',
  EMBEDDED: '内封',
  INTERNAL: '内嵌',
  NONE: '无字幕'
}

export const SUBTITLE_TYPE_ZH_TRAD: Record<SubtitleType, string> = {
  EXTERNAL: '外掛',
  EMBEDDED: '內封',
  INTERNAL: '內嵌',
  NONE: '無字幕'
}

export const SUBTITLE_TYPE_I18N_KEY: Record<SubtitleType, string> = {
  EXTERNAL: 'subtitle.external',
  EMBEDDED: 'subtitle.embedded',
  INTERNAL: 'subtitle.internal',
  NONE: 'subtitle.none'
}

/** Nyaa 分类代码（发布接口 nyaaCategory） */
export const NYAA_CATEGORIES: Array<{ code: string; label: string }> = [
  { code: '1_1', label: 'Anime - AMV' },
  { code: '1_2', label: 'Anime - English-translated' },
  { code: '1_3', label: 'Anime - Non-English-translated（中文动画字幕常用）' },
  { code: '1_4', label: 'Anime - Raw' },
  { code: '2_1', label: 'Audio - Lossless' },
  { code: '2_2', label: 'Audio - Lossy' },
  { code: '3_1', label: 'Literature - English-translated' },
  { code: '3_2', label: 'Literature - Non-English-translated' },
  { code: '3_3', label: 'Literature - Raw' },
  { code: '4_1', label: 'Live Action - English-translated' },
  { code: '4_2', label: 'Live Action - Idol/Promotional Video' },
  { code: '4_3', label: 'Live Action - Non-English-translated' },
  { code: '4_4', label: 'Live Action - Raw' },
  { code: '5_1', label: 'Pictures - Graphics' },
  { code: '5_2', label: 'Pictures - Photos' },
  { code: '6_1', label: 'Software - Applications' },
  { code: '6_2', label: 'Software - Games' }
]

/** Nyaa 代发要求种子包含该 tracker */
export const NYAA_TRACKER = 'http://nyaa.tracker.wf:7777/announce'

export const ANIBT_BASE_URL = 'https://anibt.net'

/**
 * 站点接受的枚举值（来源：wiki.anibt.net/docs/open-api/reference）。
 * 发上去的值不在表里 → 422 VALIDATION_ERROR，而站点只回一句
 * 「Invalid request body」，不告诉你是哪个字段。所以发之前自己先拦一道。
 *
 * 注意和 UI 那几个列表的区别：RESOLUTIONS / VIDEO_FORMATS 是**下拉里列出来的**，
 * 允许用户填「自定义」；下面这几个是**站点真正认的**，是硬约束。
 */
export const API_RESOLUTIONS: readonly string[] = ['4K', '2160p', '1080p', '720p', '480p', '360p']

export const API_VIDEO_FORMATS: readonly string[] = ['MKV', 'MP4', 'AVI', 'WEBM']

export const API_SUBTITLE_TYPES: readonly string[] = ['EXTERNAL', 'INTERNAL', 'EMBEDDED', 'NONE']

export const API_LANGUAGES: readonly string[] = [
  'CHS', 'CHT', 'JP', 'EN', 'KO', 'ES', 'PT', 'FR', 'DE', 'IT', 'RU',
  'AR', 'HI', 'ID', 'MS', 'TH', 'VI', 'TL', 'TR', 'PL', 'UK'
]

/** notes 上限 50000 字符（wiki） */
export const NOTES_MAX_LENGTH = 50000

/** 主题色预设 */
export const ACCENT_PRESETS = ['#fb7299', '#00b3f2', '#fb923c'] as const
export const DEFAULT_ACCENT = '#fb7299'

/** 默认可选字幕语言（可在发布行内自定义追加） */
export const DEFAULT_LANGUAGES: LanguageCode[] = ['CHS', 'CHT', 'JP', 'EN']

/**
 * 语言代码的规范顺序：CHS / CHT / JP / EN。
 * 词库命中顺序是按「词长」来的，不是按语义 —— 文件名里先出现 JPN 再出现 CHS，
 * 直接拼就会得到「JP&CHS」。所有对外展示/拼接的地方都先过 sortLanguages。
 * 不在表里的自定义代码（KR、FR…）按原相对顺序排在后面。
 */
const LANGUAGE_ORDER: Record<string, number> = { CHS: 0, CHT: 1, JP: 2, EN: 3 }

export function sortLanguages(languages: LanguageCode[]): LanguageCode[] {
  const rank = (l: LanguageCode): number => LANGUAGE_ORDER[l] ?? 100
  return [...languages]
    .map((l, i) => ({ l, i }))
    .sort((a, b) => rank(a.l) - rank(b.l) || a.i - b.i)
    .map((x) => x.l)
}

/** 版本默认值 */
export const DEFAULT_VERSION = 'v1'
