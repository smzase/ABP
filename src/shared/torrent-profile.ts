import type {
  AnimeFilenameExample,
  AnimeFilenameExamples,
  LanguageCode,
  ParsedName,
  SubtitleDetectRule,
  SubtitleType
} from './types.ts'
import { DEFAULT_SUBTITLE_RULES } from './subtitle-detect.ts'
import { parseFileName } from './parse-name.ts'

export type FilenameExampleKind = 'simpInternal' | 'tradInternal' | 'embedded'

export interface TorrentProfile {
  resolution: string | null
  format: string | null
  subtitleType: SubtitleType | null
  languages: LanguageCode[]
  codec: string | null
  bitDepth: string | null
  audioCodec: string | null
  source: string | null
  version: string | null
}

/**
 * Explicit words from the subtitle dictionary always win. Container inference is
 * only a fallback for common releases whose names carry language codes but no type.
 */
export function inferSubtitleType(
  format: string | null,
  languages: LanguageCode[],
  explicit: SubtitleType | null
): SubtitleType {
  if (explicit) return explicit
  if (languages.length === 0) return 'NONE'
  const normalized = format?.toUpperCase()
  if (normalized === 'MP4') return 'INTERNAL'
  if (normalized === 'MKV') return 'EMBEDDED'
  return 'EMBEDDED'
}

export function profileFromParsed(parsed: ParsedName): TorrentProfile {
  return {
    resolution: parsed.resolution,
    format: parsed.format,
    subtitleType: inferSubtitleType(parsed.format, parsed.languages, parsed.subtitleType),
    languages: [...parsed.languages],
    codec: parsed.codec,
    bitDepth: parsed.bitDepth,
    audioCodec: parsed.audioCodec,
    source: parsed.source,
    version: parsed.version
  }
}

export function emptyFilenameExample(): AnimeFilenameExample {
  return {
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
}

export function filenameExampleFromParsed(fileName: string, parsed: ParsedName): AnimeFilenameExample {
  return {
    fileName: fileName.trim(),
    languages: [...parsed.languages],
    subtitleType: inferSubtitleType(parsed.format, parsed.languages, parsed.subtitleType),
    resolution: parsed.resolution ?? '',
    format: parsed.format ?? '',
    codec: parsed.codec ?? '',
    bitDepth: parsed.bitDepth ?? '',
    audioCodec: parsed.audioCodec ?? '',
    source: parsed.source ?? ''
  }
}

export function exampleKindForProfile(parsed: ParsedName): FilenameExampleKind | null {
  const type = inferSubtitleType(parsed.format, parsed.languages, parsed.subtitleType)
  if (type === 'INTERNAL') {
    return parsed.languages.includes('CHT') && !parsed.languages.includes('CHS') ? 'tradInternal' : 'simpInternal'
  }
  if (type === 'EMBEDDED') return 'embedded'
  return null
}

function exampleFileName(example: AnimeFilenameExample | string): string {
  return typeof example === 'string' ? example.trim() : example.fileName.trim()
}

export function parseFilenameExample(
  example: AnimeFilenameExample | string,
  rules: SubtitleDetectRule[] = DEFAULT_SUBTITLE_RULES
): TorrentProfile | null {
  const fileName = exampleFileName(example)
  if (!fileName) return null
  const parsed = parseFileName(fileName, rules)
  if (typeof example === 'string') return profileFromParsed(parsed)

  const languages = example.languages.length > 0 ? [...example.languages] : [...parsed.languages]
  const format = example.format.trim() || parsed.format
  return {
    resolution: example.resolution.trim() || parsed.resolution,
    format,
    subtitleType: inferSubtitleType(format, languages, example.subtitleType ?? parsed.subtitleType),
    languages,
    codec: example.codec.trim() || parsed.codec,
    bitDepth: example.bitDepth.trim() || parsed.bitDepth,
    audioCodec: example.audioCodec.trim() || parsed.audioCodec,
    source: example.source.trim() || parsed.source,
    version: parsed.version
  }
}


/** Apply the selected filename example while preserving the current torrent episode/version. */
export function applyFilenameExample(
  parsed: ParsedName,
  examples: AnimeFilenameExamples | undefined,
  rules: SubtitleDetectRule[] = DEFAULT_SUBTITLE_RULES
): ParsedName {
  if (!examples) return parsed
  const kind = exampleKindForProfile(parsed)
  if (!kind) return parsed
  const learned = parseFilenameExample(examples[kind], rules)
  if (!learned) return parsed
  const languages = learned.languages.length > 0 ? [...learned.languages] : [...parsed.languages]
  const format = learned.format ?? parsed.format
  const subtitleType = learned.subtitleType ?? parsed.subtitleType
  return {
    episode: parsed.episode,
    resolution: learned.resolution ?? parsed.resolution,
    codec: learned.codec ?? parsed.codec,
    bitDepth: learned.bitDepth ?? parsed.bitDepth,
    audioCodec: learned.audioCodec ?? parsed.audioCodec,
    source: learned.source ?? parsed.source,
    format,
    version: parsed.version,
    languages: learned.subtitleType === 'NONE' ? [] : languages,
    subtitleType: learned.subtitleType === 'NONE' ? 'NONE' : inferSubtitleType(format, languages, subtitleType)
  }
}

/** Fill the first empty example slot; explicit user examples are never overwritten. */
export function learnFilenameExample(
  examples: AnimeFilenameExamples,
  kind: FilenameExampleKind | null,
  example: AnimeFilenameExample | string
): AnimeFilenameExamples {
  if (!kind) return examples
  const current = typeof examples[kind] === 'string'
    ? { ...emptyFilenameExample(), fileName: examples[kind] as unknown as string }
    : examples[kind]
  if (current.fileName.trim()) return examples
  const next = typeof example === 'string'
    ? { ...emptyFilenameExample(), fileName: example.trim() }
    : { ...example, fileName: example.fileName.trim(), languages: [...example.languages] }
  if (!next.fileName) return examples
  return { ...examples, [kind]: next }
}