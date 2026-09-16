import { sortLanguages } from './constants.ts'
import type { LanguageCode, SubtitleDetectRule, SubtitleType } from './types.ts'

/**
 * 字幕识别：按用户词库把文件名里的「词」映射为字幕语言 + 字幕类型。
 * 匹配规则：忽略大小写、包含匹配、长词优先（避免 CHS 抢先于 CHS_JP）。
 *
 * 命中是**累加**的：一个文件名可以同时命中多条词，语言取并集，
 * 字幕类型取第一条（最长的那条）带类型的词。最终语言顺序统一排成 CHS/CHT/JP/EN。
 *
 * 两个约定，词库里很多条目都依赖它：
 * - CHI 是「中文」不分简繁 → CHS+CHT（CHS/CHT 才是明确的简/繁）。
 *   所以 CHI_JPN 是 CHS+CHT+JP，不是 CHS+JP。
 * - 中文词只收**两字以上的组合**（简日、繁日、简繁…）。
 *   单字「日」「英」「繁」在番剧名里太常见（夏日、日常、英雄…），
 *   收进来必然误判，交给 JP/JPN/EN 这些带边界保护的代码词去认。
 */

/** 预设词库（用户可在设置里自由增删改） */
export const DEFAULT_SUBTITLE_RULES: SubtitleDetectRule[] = [
  // ---- 中文组合词：语言 + 类型一次命中（长词优先，排在最前） ----
  { word: '简繁日内封', langs: ['CHS', 'CHT', 'JP'], type: 'EMBEDDED' },
  { word: '簡繁日內封', langs: ['CHS', 'CHT', 'JP'], type: 'EMBEDDED' },
  { word: '简繁日内嵌', langs: ['CHS', 'CHT', 'JP'], type: 'INTERNAL' },
  { word: '简繁日外挂', langs: ['CHS', 'CHT', 'JP'], type: 'EXTERNAL' },
  { word: '简繁内封', langs: ['CHS', 'CHT'], type: 'EMBEDDED' },
  { word: '簡繁內封', langs: ['CHS', 'CHT'], type: 'EMBEDDED' },
  { word: '简繁内嵌', langs: ['CHS', 'CHT'], type: 'INTERNAL' },
  { word: '简繁外挂', langs: ['CHS', 'CHT'], type: 'EXTERNAL' },
  { word: '简日内封', langs: ['CHS', 'JP'], type: 'EMBEDDED' },
  { word: '简日内嵌', langs: ['CHS', 'JP'], type: 'INTERNAL' },
  { word: '简日外挂', langs: ['CHS', 'JP'], type: 'EXTERNAL' },
  { word: '繁日内封', langs: ['CHT', 'JP'], type: 'EMBEDDED' },
  { word: '繁日內封', langs: ['CHT', 'JP'], type: 'EMBEDDED' },
  { word: '繁日内嵌', langs: ['CHT', 'JP'], type: 'INTERNAL' },
  { word: '繁日內嵌', langs: ['CHT', 'JP'], type: 'INTERNAL' },
  { word: '繁日外挂', langs: ['CHT', 'JP'], type: 'EXTERNAL' },
  { word: '简体内嵌', langs: ['CHS'], type: 'INTERNAL' },
  { word: '简体内封', langs: ['CHS'], type: 'EMBEDDED' },
  { word: '简体外挂', langs: ['CHS'], type: 'EXTERNAL' },
  { word: '繁体内嵌', langs: ['CHT'], type: 'INTERNAL' },
  { word: '繁體內嵌', langs: ['CHT'], type: 'INTERNAL' },
  { word: '繁体内封', langs: ['CHT'], type: 'EMBEDDED' },
  { word: '繁體內封', langs: ['CHT'], type: 'EMBEDDED' },
  { word: '繁体外挂', langs: ['CHT'], type: 'EXTERNAL' },

  // ---- 纯语言组合词（不含类型） ----
  { word: '简繁日', langs: ['CHS', 'CHT', 'JP'], type: null },
  { word: '簡繁日', langs: ['CHS', 'CHT', 'JP'], type: null },
  { word: '中日双语', langs: ['CHS', 'CHT', 'JP'], type: null },
  { word: '中英双语', langs: ['CHS', 'CHT', 'EN'], type: null },
  { word: '简日双语', langs: ['CHS', 'JP'], type: null },
  { word: '繁日雙語', langs: ['CHT', 'JP'], type: null },
  { word: '简繁', langs: ['CHS', 'CHT'], type: null },
  { word: '簡繁', langs: ['CHS', 'CHT'], type: null },
  { word: '简日', langs: ['CHS', 'JP'], type: null },
  { word: '簡日', langs: ['CHS', 'JP'], type: null },
  { word: '繁日', langs: ['CHT', 'JP'], type: null },
  { word: '简英', langs: ['CHS', 'EN'], type: null },
  { word: '繁英', langs: ['CHT', 'EN'], type: null },
  { word: '简体', langs: ['CHS'], type: null },
  { word: '簡體', langs: ['CHS'], type: null },
  { word: '繁体', langs: ['CHT'], type: null },
  { word: '繁體', langs: ['CHT'], type: null },
  { word: '日语', langs: ['JP'], type: null },
  { word: '日語', langs: ['JP'], type: null },
  { word: '英语', langs: ['EN'], type: null },
  { word: '英語', langs: ['EN'], type: null },

  // ---- 语言代码组合（CHI = 中文不分简繁 → 简+繁） ----
  { word: 'CHS_CHT_JPN', langs: ['CHS', 'CHT', 'JP'], type: null },
  { word: 'CHS_CHT_JP', langs: ['CHS', 'CHT', 'JP'], type: null },
  { word: 'CHS&CHT&JP', langs: ['CHS', 'CHT', 'JP'], type: null },
  { word: 'CHI_JPN', langs: ['CHS', 'CHT', 'JP'], type: null },
  { word: 'CHI_JP', langs: ['CHS', 'CHT', 'JP'], type: null },
  { word: 'CHI&JP', langs: ['CHS', 'CHT', 'JP'], type: null },
  { word: 'CHS_CHT', langs: ['CHS', 'CHT'], type: null },
  { word: 'CHS&CHT', langs: ['CHS', 'CHT'], type: null },
  { word: 'CHS_JPN', langs: ['CHS', 'JP'], type: null },
  { word: 'CHS_JP', langs: ['CHS', 'JP'], type: null },
  { word: 'CHS&JP', langs: ['CHS', 'JP'], type: null },
  // Nyaa 常见紧凑写法：JP + SC/TC（Japanese + Simplified/Traditional Chinese）
  { word: 'JPSC', langs: ['CHS', 'JP'], type: null },
  { word: 'JPTC', langs: ['CHT', 'JP'], type: null },
  { word: 'CHT_JPN', langs: ['CHT', 'JP'], type: null },
  { word: 'CHT_JP', langs: ['CHT', 'JP'], type: null },
  { word: 'CHT&JP', langs: ['CHT', 'JP'], type: null },
  { word: 'GB_JP', langs: ['CHS', 'JP'], type: null },
  { word: 'BIG5_JP', langs: ['CHT', 'JP'], type: null },

  // ---- 单个语言代码 ----
  { word: 'CHS', langs: ['CHS'], type: null },
  { word: 'CHT', langs: ['CHT'], type: null },
  // CHI/ZH 只说明「中文」，不区分简繁 —— 按简+繁计
  { word: 'CHI', langs: ['CHS', 'CHT'], type: null },
  { word: 'ZH', langs: ['CHS', 'CHT'], type: null },
  { word: 'SC', langs: ['CHS'], type: null },
  { word: 'TC', langs: ['CHT'], type: null },
  { word: 'GB', langs: ['CHS'], type: null },
  { word: 'BIG5', langs: ['CHT'], type: null },
  { word: 'JPN', langs: ['JP'], type: null },
  { word: 'JP', langs: ['JP'], type: null },
  { word: 'ENG', langs: ['EN'], type: null },
  { word: 'EN', langs: ['EN'], type: null },

  // ---- 只说明字幕类型 ----
  { word: '外挂', langs: [], type: 'EXTERNAL' },
  { word: '外掛', langs: [], type: 'EXTERNAL' },
  { word: '内封', langs: [], type: 'EMBEDDED' },
  { word: '內封', langs: [], type: 'EMBEDDED' },
  { word: '内嵌', langs: [], type: 'INTERNAL' },
  { word: '內嵌', langs: [], type: 'INTERNAL' },
  { word: '无字幕', langs: [], type: 'NONE' },
  { word: '無字幕', langs: [], type: 'NONE' },
  { word: 'RAW', langs: [], type: 'NONE' }
]

export interface SubtitleDetectResult {
  languages: LanguageCode[]
  subtitleType: SubtitleType | null
  /** 命中的词（调试用） */
  hits: string[]
}

/** 误判防护：SC/TC/EN/JP 这类短词必须独立出现（前后非字母数字） */
function isWordHit(name: string, word: string): boolean {
  const idx = name.indexOf(word)
  if (idx < 0) return false
  // 纯字母数字短词（≤3）要求边界
  if (/^[A-Z0-9]+$/i.test(word) && word.length <= 3) {
    const before = idx > 0 ? name[idx - 1] : ''
    const after = idx + word.length < name.length ? name[idx + word.length] : ''
    if (/[A-Z0-9]/i.test(before) || /[A-Z0-9]/i.test(after)) return false
  }
  return true
}

export function detectSubtitle(fileName: string, rules: SubtitleDetectRule[]): SubtitleDetectResult {
  const upper = fileName.toUpperCase()
  const sorted = [...rules]
    .filter((r) => r.word.trim().length > 0)
    .sort((a, b) => b.word.length - a.word.length)

  const languages: LanguageCode[] = []
  let subtitleType: SubtitleType | null = null
  const hits: string[] = []

  for (const rule of sorted) {
    if (!isWordHit(upper, rule.word.toUpperCase())) continue
    hits.push(rule.word)
    for (const lang of rule.langs) {
      if (!languages.includes(lang)) languages.push(lang)
    }
    if (rule.type && !subtitleType) subtitleType = rule.type
  }
  // 命中顺序 = 词长顺序，和语义无关；统一排成 CHS/CHT/JP/EN 再交出去
  return { languages: sortLanguages(languages), subtitleType, hits }
}
