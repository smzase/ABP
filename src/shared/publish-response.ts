import type { PublishResult } from './types.ts'

interface PublishResponseObject {
  ok?: unknown
  previewUrl?: unknown
  result?: unknown
  error?: unknown
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * AniBT 正式发布和 Preview 的成功响应不是同一个形状：
 * 正式发布返回 result.releaseId，Preview 返回顶层 previewUrl。
 * 统一在 IPC 边界解析，避免把 Preview 当成正式发布响应读取 result。
 */
export function parsePublishResponse(body: unknown, httpStatus?: number): PublishResult {
  if (!isObject(body)) {
    return {
      ok: false,
      error: { message: `${httpStatus ?? ''} AniBT 返回了无法识别的发布响应`.trim(), httpStatus }
    }
  }

  const response = body as PublishResponseObject
  if (response.ok !== true) {
    const error = isObject(response.error) ? response.error : null
    const message = typeof error?.message === 'string' ? error.message : 'AniBT 发布失败'
    return { ok: false, error: { message, httpStatus } }
  }

  if (typeof response.previewUrl === 'string' && response.previewUrl.startsWith('https://')) {
    return { ok: true, previewUrl: response.previewUrl }
  }

  if (isObject(response.result) && typeof response.result.releaseId === 'string' && response.result.releaseId) {
    return {
      ok: true,
      releaseId: response.result.releaseId,
      matchStatus: typeof response.result.matchStatus === 'string' ? response.result.matchStatus : undefined,
      fileSize: typeof response.result.fileSize === 'number' ? response.result.fileSize : undefined
    }
  }

  return {
    ok: false,
    error: { message: `${httpStatus ?? ''} AniBT 返回了无法识别的发布响应`.trim(), httpStatus }
  }
}
