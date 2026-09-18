export interface MikanPublishInput {
  title: string
  torrentBase64: string
  descriptionBbcode: string
  bangumiId: number | null
  subtitleGroupId: number | null
  publishGroupId: number | null
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
