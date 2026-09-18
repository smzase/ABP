import type { AnimeTemplate } from './types.ts'

/** 将标题变成适合文件名匹配的稳定形式，保留中日韩文字与拉丁字母。 */
export function normalizeAnimeMatchText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/\.(torrent|mkv|mp4|avi|webm)$/i, '')
    .replace(/[^\p{Letter}\p{Number}\u3040-\u30ff\u3400-\u9fff]+/gu, ' ')
    .trim()
}

function compact(value: string): string {
  return normalizeAnimeMatchText(value).replace(/\s+/g, '')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function containsName(haystack: string, compactHaystack: string, name: string): boolean {
  const nameCompact = compact(name)
  // 纯数字短标题无法和“另一部作品的第 86 集”可靠区分；Bangumi 模板通常还有
  // 中文全名、日文名或英文名可用。宁可不自动选，也不能选错模板。
  if (/^\d+$/.test(nameCompact)) return false

  if (/^[a-z0-9 ]+$/i.test(name)) {
    const tokenPattern = new RegExp(`(?:^| )${escapeRegExp(name)}(?:$| )`, 'i')
    if (tokenPattern.test(haystack)) return true
  } else if (haystack.includes(name)) {
    return true
  }

  // 紧凑匹配用于兼容点号/连字符/空格差异；太短的词会在组名或元数据中误命中。
  return nameCompact.length >= 4 && compactHaystack.includes(nameCompact)
}

/** 根据种子文件名/内部名选择最可能的番剧模板，名称越长优先级越高。 */
export function matchAnimeTemplateId(fileName: string, innerName: string, templates: AnimeTemplate[]): string {
  const haystack = normalizeAnimeMatchText(`${fileName} ${innerName}`)
  const compactHaystack = compact(haystack)
  let best: { id: string; score: number } | null = null

  for (const template of templates) {
    const names = Object.values(template.names)
      .map((name) => normalizeAnimeMatchText(name))
      .filter((name) => name.length >= 2)
    for (const name of names) {
      const nameCompact = compact(name)
      if (!containsName(haystack, compactHaystack, name)) continue
      const score = nameCompact.length
      if (!best || score > best.score) best = { id: template.id, score }
    }
  }
  return best?.id ?? ''
}
