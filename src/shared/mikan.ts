import type { MikanSearchItem, MikanSearchKind } from './types.ts'

export interface MikanPublishInput {
  title: string
  torrentBase64: string
  descriptionBbcode: string
  bangumiId: number | null
  subtitleGroupId: number | null
  publishGroupId: number | null
}

/** 把蜜柑三个公开搜索接口的 PascalCase 响应统一为渲染层模型。 */
export function parseMikanSearchItems(kind: MikanSearchKind, value: unknown): MikanSearchItem[] {
  if (!Array.isArray(value)) return []
  const idKey = kind === 'bangumi' ? 'BangumiId' : kind === 'subtitleGroup' ? 'SubtitleGroupId' : 'PublishGroupId'
  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return []
    const row = item as Record<string, unknown>
    const id = Number(row[idKey])
    const name = String(row.Name ?? row.ChsName ?? row.JpnName ?? '')
    if (!Number.isInteger(id) || id <= 0 || !name) return []
    const bangumiUrl = typeof row.BangumiUrl === 'string' ? row.BangumiUrl : ''
    const bgmId = Number(bangumiUrl.match(/\/subject\/(\d+)/)?.[1])
    return [{
      id,
      name,
      secondaryName: typeof row.JpnName === 'string' ? row.JpnName : undefined,
      bgmId: Number.isInteger(bgmId) && bgmId > 0 ? bgmId : undefined
    }]
  })
}

function normalizedTitle(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

/**
 * 自动填 Mikan ID 时优先核对搜索结果里的 bgm.tv subject id；
 * 老响应没有 BangumiUrl 时，才退回到完整标题精确匹配，绝不盲取第一条模糊结果。
 */
export function selectMikanBangumiMatch(
  items: MikanSearchItem[],
  bgmId: number,
  names: string[]
): MikanSearchItem | null {
  const bySubject = items.find((item) => item.bgmId === bgmId)
  if (bySubject) return bySubject
  const expected = new Set(names.map(normalizedTitle).filter(Boolean))
  return items.find((item) =>
    [item.name, item.secondaryName ?? ''].some((name) => expected.has(normalizedTitle(name)))
  ) ?? null
}

/** 蜜柑文档中的 trackers 明确不进入 ABP 的 payload。 */
export function buildMikanRequestBody(input: MikanPublishInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: input.title,
    torrentBase64: input.torrentBase64,
    description: input.descriptionBbcode
  }
  // Mikan only applies these two when both are present.
  if (input.bangumiId && input.subtitleGroupId) {
    body.bangumiId = input.bangumiId
    body.subtitleGroupId = input.subtitleGroupId
  }
  if (input.publishGroupId) body.publishGroupId = input.publishGroupId
  return body
}
