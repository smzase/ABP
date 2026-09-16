import { net } from 'electron'
import { ANIBT_BASE_URL } from '../shared/constants.ts'
import type {
  ApiResult,
  BgmSearchItem,
  BgmAnimeDetails,
  DeleteResult,
  GroupMeResult,
  PublishPayload,
  PublishResult,
  WhoamiResult
} from '../shared/types.ts'
import { parsePublishResponse } from '../shared/publish-response.ts'
import { getTorrent } from './torrents.ts'

/**
 * AniBT API 客户端。统一走 Electron net.fetch（继承 session 代理）。
 * 错误格式见 wiki：{ ok:false, error:{ code, message, ... } }。
 */

interface ErrorBody {
  ok?: boolean
  error?: { code?: string; message?: string; details?: unknown; issues?: unknown; fields?: unknown }
}

function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` }
}

/**
 * 把校验错误里的字段级信息压成一行。
 * 422 的 message 往往只有一句「Invalid request body」，真正有用的是它下面挂的
 * details / issues / fields（zod 之类的校验器都会给出 path + message）。
 * 不把这些带出来，用户和维护者都只能对着一句空话猜是哪个字段错了。
 */
function formatDetails(raw: unknown): string {
  if (raw == null) return ''
  const one = (item: unknown): string => {
    if (typeof item === 'string') return item
    if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>
      // zod: { path: ['title'], message: '...' }；也兼容 field/name/msg 等写法
      const path = Array.isArray(o.path) ? o.path.join('.') : (o.path ?? o.field ?? o.name ?? '')
      const msg = o.message ?? o.msg ?? o.error ?? ''
      const text = [path, msg].filter(Boolean).join(': ')
      return text || JSON.stringify(item)
    }
    return String(item)
  }
  const list = Array.isArray(raw) ? raw.map(one) : [one(raw)]
  return list.filter(Boolean).join('; ')
}

async function readError(res: Response): Promise<string> {
  // 响应体只能读一次：先拿文本，再尝试解析成 JSON，
  // 这样即使不是 JSON（网关的 HTML 错误页之类）也还能把原文带出来
  let text: string
  try {
    text = await res.text()
  } catch {
    return `${res.status} ${res.statusText}`
  }
  try {
    const body = JSON.parse(text) as ErrorBody
    const head = `${res.status} ${body?.error?.code ?? ''} ${body?.error?.message ?? ''}`.replace(/\s+/g, ' ').trim()
    const detail = formatDetails(body?.error?.details ?? body?.error?.issues ?? body?.error?.fields)
    if (head || detail) return [head, detail].filter(Boolean).join(' — ').slice(0, 600)
  } catch {
    /* 不是 JSON，落到下面用原文 */
  }
  const snippet = text.trim().slice(0, 300)
  return snippet ? `${res.status} ${res.statusText}: ${snippet}` : `${res.status} ${res.statusText}`
}

export async function whoami(apiKey: string): Promise<ApiResult<WhoamiResult>> {
  try {
    const res = await net.fetch(`${ANIBT_BASE_URL}/api/releases/publish`, { headers: authHeaders(apiKey) })
    if (!res.ok) return { ok: false, error: await readError(res) }
    const body = (await res.json()) as { ok: boolean; result: WhoamiResult }
    return { ok: true, data: body.result }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

export async function groupMe(apiKey: string): Promise<ApiResult<GroupMeResult>> {
  try {
    const res = await net.fetch(`${ANIBT_BASE_URL}/api/subtitle-groups/me`, { headers: authHeaders(apiKey) })
    if (!res.ok) return { ok: false, error: await readError(res) }
    const body = (await res.json()) as { ok: boolean; data: GroupMeResult }
    return { ok: true, data: body.data }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

export async function bgmSearch(q: string, limit = 10): Promise<ApiResult<BgmSearchItem[]>> {
  try {
    const url = `${ANIBT_BASE_URL}/api/bgm/search?q=${encodeURIComponent(q)}&limit=${limit}`
    const res = await net.fetch(url)
    if (!res.ok) return { ok: false, error: await readError(res) }
    const body = (await res.json()) as { ok: boolean; data: BgmSearchItem[] }
    return { ok: true, data: body.data ?? [] }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

interface BangumiInfoboxItem {
  key?: unknown
  value?: unknown
}

function stringsFromBangumiValue(value: unknown): string[] {
  if (typeof value === 'string') return [value.trim()].filter(Boolean)
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item === 'string') return [item.trim()].filter(Boolean)
    if (item && typeof item === 'object') {
      const v = (item as Record<string, unknown>).v
      return typeof v === 'string' ? [v.trim()].filter(Boolean) : []
    }
    return []
  })
}

function pickBangumiNames(raw: Record<string, unknown>, bgmId: number): BgmAnimeDetails {
  const name = typeof raw.name === 'string' ? raw.name : ''
  const nameCn = typeof raw.name_cn === 'string' ? raw.name_cn : ''
  const info = Array.isArray(raw.infobox) ? (raw.infobox as BangumiInfoboxItem[]) : []
  const aliasEntry = info.find((item) => item.key === '别名' || item.key === '別名')
  const aliases = stringsFromBangumiValue(aliasEntry?.value).filter((x) => x !== name && x !== nameCn)
  const latin = aliases.filter((x) => /[A-Za-z]/.test(x))
  const romanHint = /\b(no|wa|ga|ni|de|to|mo|yo|tsu|shi|chi|kun|san|chan|sama)\b/i
  const englishHint = /[:'’]|\b(the|of|and|for|beyond|journey|season|story|world)\b/i
  let romaji = latin.find((x) => romanHint.test(x)) ?? ''
  let en = latin.find((x) => englishHint.test(x) && x !== romaji) ?? ''
  if (!romaji && latin.length === 1 && !englishHint.test(latin[0])) romaji = latin[0]
  if (!en && latin.length > 1) en = latin.find((x) => x !== romaji) ?? ''
  if (!romaji && latin.length > 1) romaji = latin.find((x) => x !== en) ?? ''
  return { bgmId, name, nameCn, romaji, en }
}

/** 通过 Bangumi Open API 补充罗马音与英文别名。 */
export async function bgmDetails(bgmId: number): Promise<ApiResult<BgmAnimeDetails>> {
  if (!Number.isInteger(bgmId) || bgmId <= 0) return { ok: false, error: '无效的 bgmId' }
  try {
    const res = await net.fetch(`https://api.bgm.tv/v0/subjects/${bgmId}`, {
      headers: { 'User-Agent': 'AniBT-Publish/0.1' }
    })
    if (!res.ok) return { ok: false, error: await readError(res) }
    const raw = (await res.json()) as Record<string, unknown>
    return { ok: true, data: pickBangumiNames(raw, bgmId) }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
/** 手动拼 multipart/form-data（net.fetch 对 FormData 的支持随版本不稳，手拼最稳） */
function buildMultipart(fields: Array<[string, string]>, fileField: string, fileName: string, fileBytes: Uint8Array): {
  body: Uint8Array
  contentType: string
} {
  const boundary = `----ABPFormBoundary${crypto.randomUUID().replace(/-/g, '')}`
  const chunks: Uint8Array[] = []
  const te = new TextEncoder()
  const push = (s: string): void => {
    chunks.push(te.encode(s))
  }
  for (const [name, value] of fields) {
    push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)
  }
  push(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${fileName.replace(/"/g, '_')}"\r\nContent-Type: application/x-bittorrent\r\n\r\n`
  )
  chunks.push(fileBytes)
  push(`\r\n--${boundary}--\r\n`)
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const body = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    body.set(c, offset)
    offset += c.length
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` }
}

export async function publishRelease(payload: PublishPayload): Promise<PublishResult> {
  const torrent = getTorrent(payload.torrentToken)
  if (!torrent) return { ok: false, error: { message: '种子已不在内存中，请重新添加文件' } }

  // 只放非空字段：空串不是「用默认值」，站点会拿它当一个显式的非法值来校验。
  // publishedAt 不发 —— 站点默认用服务器当前时间，我们本来也没有真实发布时间可填。
  const fields: Array<[string, string]> = [
    ['animeIdType', payload.animeIdType],
    ['animeId', payload.animeId]
  ]
  const addIf = (name: string, value: string | undefined | null): void => {
    if (value != null && String(value).trim() !== '') fields.push([name, String(value)])
  }
  addIf('title', payload.title)
  addIf('episodeKey', payload.episodeKey)
  addIf('resolution', payload.resolution)
  addIf('subtitle', payload.subtitle)
  addIf('format', payload.format)
  addIf('version', payload.version || 'v1')
  addIf('notes', payload.notes)
  for (const lang of payload.language) if (lang && lang.trim()) fields.push(['language', lang])
  if (payload.preview) fields.push(['preview', 'true'])
  if (payload.nyaa) {
    fields.push(['nyaa', 'true'])
    fields.push(['nyaaCategory', payload.nyaaCategory || '1_3'])
  }

  const { body, contentType } = buildMultipart(fields, 'torrent', torrent.fileName, torrent.bytes)

  try {
    const res = await net.fetch(`${ANIBT_BASE_URL}/api/releases/publish`, {
      method: 'POST',
      headers: { ...authHeaders(payload.apiKey), 'Content-Type': contentType },
      // Electron net 实际接受 BufferSource；TS 的 BodyInit 泛型收窄过不去，明确断言
      body: body as unknown as BodyInit
    })
    if (!res.ok) {
      const msg = await readError(res)
      return { ok: false, error: { message: msg, httpStatus: res.status } }
    }
    return parsePublishResponse(await res.json(), res.status)
  } catch (err) {
    return { ok: false, error: { message: String(err) } }
  }
}

export async function deleteRelease(apiKey: string, releaseId: string): Promise<DeleteResult> {
  try {
    const res = await net.fetch(`${ANIBT_BASE_URL}/api/releases/${encodeURIComponent(releaseId)}`, {
      method: 'DELETE',
      headers: authHeaders(apiKey)
    })
    if (res.status === 200) return { ok: true, state: 'completed' }
    if (res.status === 202) return { ok: true, state: 'pending' }
    return { ok: false, error: await readError(res) }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

export async function deletionStatus(apiKey: string, releaseId: string): Promise<DeleteResult> {
  try {
    const res = await net.fetch(`${ANIBT_BASE_URL}/api/releases/${encodeURIComponent(releaseId)}/deletion`, {
      headers: authHeaders(apiKey)
    })
    if (!res.ok) return { ok: false, error: await readError(res) }
    const json = (await res.json()) as { result?: { state?: 'pending' | 'completed' | 'failed' } }
    return { ok: true, state: json.result?.state ?? 'pending' }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/** 繁化姬：简体 → 繁体。免费档无需 API Key。 */
export async function zhconvertTraditional(text: string): Promise<ApiResult<string>> {
  try {
    const res = await net.fetch('https://api.zhconvert.org/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ text, converter: 'Traditional' }).toString()
    })
    if (!res.ok) return { ok: false, error: await readError(res) }
    const json = (await res.json()) as { code?: number; data?: { text?: string }; msg?: string }
    if (json.code !== 0 || !json.data?.text) {
      return { ok: false, error: json.msg || '繁化姬转换失败' }
    }
    return { ok: true, data: json.data.text }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

export async function proxyTest(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const started = Date.now()
  try {
    const res = await net.fetch(`${ANIBT_BASE_URL}/api/subtitle-groups`, { method: 'GET' })
    if (!res.ok) return { ok: false, error: `${res.status} ${res.statusText}` }
    return { ok: true, latencyMs: Date.now() - started }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
