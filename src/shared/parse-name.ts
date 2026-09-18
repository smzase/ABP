import type { ParsedName, SubtitleDetectRule } from './types.ts'
import { detectSubtitle, DEFAULT_SUBTITLE_RULES } from './subtitle-detect.ts'

/**
 * 从种子文件名/内部名解析发布元信息：集数、分辨率、编码、位深、音频、片源、版本。
 * 字幕语言与字幕类型走词库（detectSubtitle）。
 */

const RESOLUTION_RE = /\b(2160|1080|720|480|360)[pP]\b|\b(4[Kk]|8[Kk])\b/

/**
 * 集数只能来自有明确语法含义的位置，不能靠“看见 1~3 位数字”猜。
 *
 * Nyaa 的真实命名里很常见 `作品名 2 - 08`、`藤本树 17-26][07]`、
 * `VIRGIN PUNK - 01 Clockwork Girl`。把任意两个数字间的横杠视为范围，会把
 * 季数/标题数字吞进集数；取第一个范围又会让标题里的 17-26 抢走真正的 07。
 */
const EPISODE_NUMBER = String.raw`\d{1,3}(?:\.[05])?`
const SEASON_EPISODE_RE = new RegExp(
  String.raw`\bS\d{1,2}[\s._-]?E(${EPISODE_NUMBER})(?:[\s._-]*[vV](\d+))?\b`,
  'i'
)
const EXPLICIT_EPISODE_RE = new RegExp(
  String.raw`(?:^|[\s[【(（\-_])(?:EP(?:ISODE)?|#)\s*[._-]?\s*(${EPISODE_NUMBER})(?:[\s._-]*[vV](\d+))?(?=\s*(?:$|\s|\]|】))`,
  'i'
)
const CHINESE_EPISODE_RE = new RegExp(
  String.raw`(?:^|[\s[【(（\-_])第\s*(${EPISODE_NUMBER})(?=\s*(?:集|話|话|$))`,
  'i'
)
const BRACKET_EPISODE_RE = new RegExp(
  String.raw`[\[【]\s*(${EPISODE_NUMBER})(?:\s*[-~–—至到_]\s*(${EPISODE_NUMBER}))?(?:\s*[vV](\d+))?(?:\s*(?:[（(][^）)]*[）)]|精校合集|修正合集|合集|全集|完结|完結|END|FIN))*\s*[\]】]`,
  'i'
)
const SPECIAL_EPISODE_RE = /[[【]\s*((?:OVA|OAD|SP|SPECIAL|EXTRA)(?:[\s._-]?\d{1,3})?)\s*[\]】]/i
const DASH_EPISODE_RE = new RegExp(
  String.raw`\s[-–—]\s*(${EPISODE_NUMBER})(?:\s*[（(]\s*\d{1,3}\s*[）)])?(?:[\s._-]*[vV](\d+))?(?=$|[\s[【(（])`,
  'i'
)

/** 独立的 [V2] 或元数据块后的 V2；标题中的 “Show V2” 不是修订版本。 */
const BRACKET_VERSION_RE = /[[【(（]\s*[vV](\d+)\s*[\]】)）]/i
const TRAILING_VERSION_RE = /(?:[\]】)）])\s*[vV](\d+)(?!\d)/i

const CODEC_RES: Array<[RegExp, string]> = [
  [/\b(HEVC|x\.?265|h\.?265)\b/i, 'HEVC'],
  [/\b(AVC|x\.?264|h\.?264)\b/i, 'AVC'],
  [/\b(AV1)\b/i, 'AV1'],
  [/\b(VP9)\b/i, 'VP9']
]
const BIT_DEPTH_RE = /\b(16|12|10|8)\s*-?\s*bit\b|\bHi10P\b/i
const AUDIO_RES: Array<[RegExp, string]> = [
  [/\bFLAC\b/i, 'FLAC'],
  [/\bOPUS\b/i, 'OPUS'],
  [/\bAAC\b/i, 'AAC'],
  [/\bE-?AC-?3\b|\bEAC3\b/i, 'EAC3'],
  [/\bAC-?3\b/i, 'AC3'],
  [/\bDTS(-?HD)?\b/i, 'DTS'],
  [/\bMP3\b/i, 'MP3']
]
const SOURCE_RES: Array<[RegExp, string]> = [
  [/\bWEB[-.? ]?DL\b/i, 'WEB-DL'],
  [/\bWebRip\b/i, 'WebRip'],
  [/\bBlu[-.? ]?ray\b|\bBDRip\b|\bBD[-.? ]?Rip\b/i, 'Blu-ray'],
  [/\bHDTV\b/i, 'HDTV'],
  [/\bDVD\b/i, 'DVD']
]

function firstMatch(re: RegExp, s: string): string | null {
  const m = re.exec(s)
  return m ? (m[1] ?? m[0]) : null
}

/** 返回最后一个匹配，避免标题里的 86 抢在真正的末尾集数前。 */
function lastMatch(re: RegExp, s: string): RegExpExecArray | null {
  const global = new RegExp(re.source, re.flags.replace('g', '') + 'g')
  let last: RegExpExecArray | null = null
  let hit: RegExpExecArray | null
  while ((hit = global.exec(s)) !== null) {
    last = hit
    if (hit[0].length === 0) global.lastIndex++
  }
  return last
}

interface EpisodeRevision {
  episode: string | null
  version: string | null
}

function normalizeSpecialEpisode(value: string): string {
  return value.toUpperCase().replace(/[\s._-]+/g, '')
}

function parseEpisodeRevision(name: string): EpisodeRevision {
  const season = lastMatch(SEASON_EPISODE_RE, name)
  if (season?.[1]) return { episode: season[1], version: season[2] ? 'v' + season[2] : null }

  const explicit = lastMatch(EXPLICIT_EPISODE_RE, name)
  if (explicit?.[1]) return { episode: explicit[1], version: explicit[2] ? 'v' + explicit[2] : null }

  const chinese = lastMatch(CHINESE_EPISODE_RE, name)
  if (chinese?.[1]) return { episode: chinese[1], version: null }

  // 取最后一个完整的数字块。[藤本树 17-26][07] 应当得到 07，而非标题里的范围。
  const bracket = lastMatch(BRACKET_EPISODE_RE, name)
  if (bracket?.[1]) {
    return {
      episode: bracket[2] ? `${bracket[1]}-${bracket[2]}` : bracket[1],
      version: bracket[3] ? 'v' + bracket[3] : null
    }
  }

  const special = lastMatch(SPECIAL_EPISODE_RE, name)
  if (special?.[1]) return { episode: normalizeSpecialEpisode(special[1]), version: null }

  // 横杠本身是槽位分隔符，只取右侧数字；绝不把左侧标题数字拼成范围。
  const dash = lastMatch(DASH_EPISODE_RE, name)
  if (dash?.[1]) return { episode: dash[1], version: dash[2] ? 'v' + dash[2] : null }

  return { episode: null, version: null }
}

function parseVersion(name: string, episodeVersion: string | null): string | null {
  const bracket = lastMatch(BRACKET_VERSION_RE, name)
  if (bracket?.[1]) return 'v' + bracket[1]

  if (episodeVersion) return episodeVersion

  const trailing = lastMatch(TRAILING_VERSION_RE, name)
  if (trailing?.[1]) return 'v' + trailing[1]

  return null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 已匹配模板时先屏蔽番剧别名，解决标题本身就是 86/100/365 等数字的歧义。 */
function maskKnownTitles(name: string, knownTitles: string[]): string {
  let masked = name.normalize('NFKC')
  const titles = knownTitles
    .map((title) => title.normalize('NFKC').trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  for (const title of titles) masked = masked.replace(new RegExp(escapeRegExp(title), 'giu'), ' ')
  return masked
}

export function parseFileName(
  fileName: string,
  rules: SubtitleDetectRule[] = DEFAULT_SUBTITLE_RULES,
  knownTitles: string[] = []
): ParsedName {
  // 去扩展名；torrent 内部名常常还带一层视频扩展名。
  const rawName = fileName.replace(/\.(torrent|mkv|mp4|avi|webm)$/i, '')
  const name = maskKnownTitles(rawName, knownTitles)

  const episodeRevision = parseEpisodeRevision(name)

  const resHit = RESOLUTION_RE.exec(name)
  const resolution = resHit ? (resHit[1] ? resHit[1] + 'p' : resHit[2].toUpperCase().replace('K', 'K')) : null

  let codec: string | null = null
  for (const [re, label] of CODEC_RES) {
    if (re.test(name)) {
      codec = label
      break
    }
  }

  const bdHit = BIT_DEPTH_RE.exec(name)
  const bitDepth = bdHit ? (bdHit[1] ? bdHit[1] + 'bit' : '10bit') : null

  let audioCodec: string | null = null
  for (const [re, label] of AUDIO_RES) {
    if (re.test(name)) {
      audioCodec = label
      break
    }
  }

  let source: string | null = null
  for (const [re, label] of SOURCE_RES) {
    if (re.test(name)) {
      source = label
      break
    }
  }

  const version = parseVersion(name, episodeRevision.version)

  const extensionFormat = /\.(mkv|mp4|avi|webm)\b/i.exec(fileName)
  const metadataFormat = /(?:^|[\s[【_-])(mkv|mp4|avi|webm)(?=$|[\s\]】_-])/i.exec(rawName)
  const format = extensionFormat?.[1] ?? metadataFormat?.[1] ?? null
  const sub = detectSubtitle(rawName, rules)
  const subtitleType = sub.subtitleType ?? (/\b(?:ASS|SRT)\s*[x×]\s*\d+\b/i.test(rawName) ? 'EMBEDDED' : null)

  return {
    episode: episodeRevision.episode,
    resolution,
    codec,
    bitDepth,
    audioCodec,
    source,
    format: format ? format.toUpperCase() : null,
    version,
    languages: sub.languages,
    subtitleType
  }
}

export { firstMatch }
