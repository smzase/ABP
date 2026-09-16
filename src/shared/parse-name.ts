import type { ParsedName, SubtitleDetectRule } from './types.ts'
import { detectSubtitle, DEFAULT_SUBTITLE_RULES } from './subtitle-detect.ts'

/**
 * 从种子文件名/内部名解析发布元信息：集数、分辨率、编码、位深、音频、片源、版本。
 * 字幕语言与字幕类型走词库（detectSubtitle）。
 */

const RESOLUTION_RE = /\b(2160|1080|720|480|360)[pP]\b|\b(4[Kk]|8[Kk])\b/

/**
 * 集数识别按「信息量」排序：季集号、范围、显式标签、元数据分隔的单集。
 *
 * 发布名里的数字不一定是集数：LV999、86 - Eighty Six、1080p 都很常见。
 * 规则因此只把紧邻元数据分隔符的数字当作单集，并且让范围（[01-13]）先于
 * 单集规则。这样合集不会被截成 01，标题里的 Lv999 也不会进入版本字段。
 */
const SEASON_EPISODE_RE = /\bS\d{1,2}[\s._-]?E(\d{1,3}(?:\.\d+)?)\b/i
const EPISODE_RANGE_RE =
  /(?:^|[\s\-_[\]【】(（])([0-9]{1,3}(?:\.\d+)?)[\s]*(?:[-~–—至到])[\s]*([0-9]{1,3}(?:\.\d+)?)(?=$|[\s\]】)）])/i
const EXPLICIT_EPISODE_RE =
  /(?:^|[\s[【(（\-_])(?:EP(?:ISODE)?|#)\s*[._-]?\s*([0-9]{1,3}(?:\.\d+)?)(?=\s*(?:$|\s|\]|】))/i
const CHINESE_EPISODE_RE =
  /(?:^|[\s[【(（\-_])第\s*([0-9]{1,3}(?:\.\d+)?)(?=\s*(?:集|話|话|$))/i
const DELIMITED_EPISODE_RE =
  /(?:^|[\s\-_[\]【】(（])([0-9]{1,3}(?:\.\d+)?)(?=\s*(?:$|[[\]【】)）\-_–—]))/i
const EPISODE_VERSION_SUFFIX_RE =
  /(?:^|[\s\-_[\]【】(（])([0-9]{1,3}(?:\.\d+)?)[\s._-]*[vV]\d+(?=\s*(?:$|[\s\]】)）\-_–—]))/i

/** 版本必须是显式修订标记：[V2]、(V2)、01v2 或紧跟集数/元数据分隔符的 v2。 */
const BRACKET_VERSION_RE = /[[【(（]\s*[vV](\d+)\s*[\]】)）]/
const TRAILING_VERSION_RE = /(?:[\]】)）])\s*[vV](\d+)(?!\d)/
const EPISODE_SUFFIX_VERSION_RE =
  /(?:\bS\d{1,2}[\s._-]?E\d{1,3}(?:\.\d+)?|(?:^|[\s\-_[\]【】(（])\d{1,3}(?:\.\d+)?)[\s._-]*[vV](\d+)(?!\d)/i

const CODEC_RES: Array<[RegExp, string]> = [
  [/\b(HEVC|x\.?265|h\.?265)\b/i, 'HEVC'],
  [/\b(AVC|x\.?264|h\.?264)\b/i, 'AVC'],
  [/\b(AV1)\b/i, 'AV1'],
  [/\b(VP9)\b/i, 'VP9']
]
const BIT_DEPTH_RE = /\b(10|8)\s*-?\s*bit\b|\bHi10P\b/i
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

function parseEpisode(name: string): string | null {
  const season = SEASON_EPISODE_RE.exec(name)
  if (season?.[1]) return season[1]

  const range = EPISODE_RANGE_RE.exec(name)
  if (range?.[1] && range[2]) return range[1] + '-' + range[2]

  const explicit = lastMatch(EXPLICIT_EPISODE_RE, name)
  if (explicit?.[1]) return explicit[1]

  const chinese = lastMatch(CHINESE_EPISODE_RE, name)
  if (chinese?.[1]) return chinese[1]

  const suffix = lastMatch(EPISODE_VERSION_SUFFIX_RE, name)
  if (suffix?.[1]) return suffix[1]

  const delimited = lastMatch(DELIMITED_EPISODE_RE, name)
  if (delimited?.[1]) return delimited[1]

  return null
}

function parseVersion(name: string): string | null {
  const bracket = BRACKET_VERSION_RE.exec(name)
  if (bracket?.[1]) return 'v' + bracket[1]

  const suffix = EPISODE_SUFFIX_VERSION_RE.exec(name)
  if (suffix?.[1]) return 'v' + suffix[1]

  const trailing = TRAILING_VERSION_RE.exec(name)
  if (trailing?.[1]) return 'v' + trailing[1]

  return null
}

export function parseFileName(
  fileName: string,
  rules: SubtitleDetectRule[] = DEFAULT_SUBTITLE_RULES
): ParsedName {
  // 去扩展名；torrent 内部名常常还带一层视频扩展名。
  const name = fileName.replace(/\.(torrent|mkv|mp4|avi|webm)$/i, '')

  const episode = parseEpisode(name)

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

  const version = parseVersion(name)

  const formatHit = /\.(mkv|mp4|avi|webm)\b/i.exec(fileName)
  const sub = detectSubtitle(name, rules)

  return {
    episode,
    resolution,
    codec,
    bitDepth,
    audioCodec,
    source,
    format: formatHit ? formatHit[1].toUpperCase() : null,
    version,
    languages: sub.languages,
    subtitleType: sub.subtitleType
  }
}

export { firstMatch }