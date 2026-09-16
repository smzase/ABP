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
      if (!haystack.includes(name) && !compactHaystack.includes(nameCompact)) continue
      const score = nameCompact.length
      if (!best || score > best.score) best = { id: template.id, score }
    }
  }
  return best?.id ?? ''
}