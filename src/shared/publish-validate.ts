import {
  API_LANGUAGES,
  API_RESOLUTIONS,
  API_SUBTITLE_TYPES,
  API_VIDEO_FORMATS,
  NOTES_MAX_LENGTH
} from './constants.ts'
import type { PublishPayload } from './types.ts'

/**
 * 发布前的本地体检。
 *
 * 站点对不合法的 body 一律回 `422 VALIDATION_ERROR / Invalid request body`，
 * 且**不告诉你是哪个字段**。与其让用户对着这句空话猜，不如在发出去之前就把
 * 「站点铁定会拒」的几种情况拦下来，用人话点名到字段：
 *
 * - title 空（新建番剧模板的标题模板是空的，忘了填就会这样）
 * - resolution / format / subtitle / language 填了站点枚举表以外的值
 *   （分辨率、格式的下拉都留了「自定义」入口，能打进 1440p / MOV 这种站点不认的值）
 * - Nyaa 代发开了却没选分类
 * - notes 超长
 *
 * 纯函数：不碰 store / IPC / DOM，可在 node 里直接单测。
 * 返回问题清单（i18n key + 参数），空数组代表通过。
 */

export interface PublishProblem {
  /** i18n key，形如 publishCheck.titleRequired */
  key: string
  /** 插值参数（如非法值、字段名），配合 i18n 文案 */
  params?: Record<string, string>
}

type Checkable = Pick<
  PublishPayload,
  'title' | 'resolution' | 'format' | 'subtitle' | 'language' | 'notes' | 'nyaa' | 'nyaaCategory'
>

export function validatePublishPayload(p: Checkable): PublishProblem[] {
  const problems: PublishProblem[] = []

  if (!p.title || !p.title.trim()) {
    problems.push({ key: 'publishCheck.titleRequired' })
  }

  // resolution / format / subtitle 是单值枚举；空值交给站点用默认值，只拦「填了但不合法」
  if (p.resolution && !API_RESOLUTIONS.includes(p.resolution)) {
    problems.push({ key: 'publishCheck.badResolution', params: { value: p.resolution } })
  }
  if (p.format && !API_VIDEO_FORMATS.includes(p.format)) {
    problems.push({ key: 'publishCheck.badFormat', params: { value: p.format } })
  }
  if (p.subtitle && !API_SUBTITLE_TYPES.includes(p.subtitle)) {
    problems.push({ key: 'publishCheck.badSubtitle', params: { value: p.subtitle } })
  }

  const badLangs = (p.language ?? []).filter((l) => !API_LANGUAGES.includes(l))
  if (badLangs.length > 0) {
    problems.push({ key: 'publishCheck.badLanguage', params: { value: badLangs.join(', ') } })
  }

  if (p.nyaa && !(p.nyaaCategory && p.nyaaCategory.trim())) {
    problems.push({ key: 'publishCheck.nyaaCategoryRequired' })
  }

  if (p.notes && p.notes.length > NOTES_MAX_LENGTH) {
    problems.push({ key: 'publishCheck.notesTooLong', params: { max: String(NOTES_MAX_LENGTH) } })
  }

  return problems
}
