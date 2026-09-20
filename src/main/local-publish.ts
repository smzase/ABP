import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { net, session, type Session } from 'electron'
import { getConfigDir } from './paths.ts'
import { addTorrent, getTorrent, removeTorrent, type PoolEntry } from './torrents.ts'
import { formatDescription } from '../shared/description-format.ts'
import type {
  ApiResult,
  AppData,
  LocalPublishPayload,
  LocalPublishResult,
  MikanSearchItem,
  MikanSearchKind,
  PublishSite,
  SiteAccountConfig,
  SiteCheckResult,
  SiteConnectionResult,
  SitePublishResult,
  StoredSiteCookie
} from '../shared/types.ts'
import * as anibt from './anibt.ts'
import { applyProxyToSession, getProxy } from './proxy.ts'
import { buildMikanRequestBody, mikanEpisodeUrl, parseMikanSearchItems } from '../shared/mikan.ts'
import { dmhyCookieHeader, extractDmhyTopicLink } from '../shared/dmhy.ts'
import { loadDmhyPublishContext } from './dmhy.ts'
import { parseTorrent } from '../shared/bencode.ts'
import {
  acgripPostAsTeamValue,
  normalizeAcgripToken,
  SITE_URLS,
  siteConfigurationError,
  unavailableCredentialCheck
} from '../shared/sites.ts'

const LOGIN_URLS: Partial<Record<PublishSite, string>> = {
  dmhy: 'https://www.dmhy.org/user',
  bangumiMoe: 'https://bangumi.moe'
}

const SITE_TEST_URLS: Partial<Record<PublishSite, string>> = {
  bangumiMoe: 'https://bangumi.moe/api/team/myteam'
}

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'

export function accountPartition(groupId: string): string {
  return `persist:abp-account-${groupId.replace(/[^a-zA-Z0-9_-]/g, '_')}`
}

function archivePath(recordId: string): string {
  const safe = recordId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(getConfigDir(), 'pending-torrents', `${safe}.torrent`)
}

function archiveTorrent(recordId: string, torrent: PoolEntry): void {
  const file = archivePath(recordId)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, torrent.bytes)
}

export function removeArchive(recordId: string): void {
  fs.rmSync(archivePath(recordId), { force: true })
}

function torrentFor(payload: LocalPublishPayload): PoolEntry | null {
  if (payload.torrentToken) {
    const live = getTorrent(payload.torrentToken)
    if (live) return live
  }
  try {
    const bytes = new Uint8Array(fs.readFileSync(archivePath(payload.recordId)))
    return {
      fileName: payload.torrentFileName,
      bytes,
      meta: null as never
    }
  } catch {
    return null
  }
}

function cookieUrl(cookie: StoredSiteCookie): string {
  const domain = cookie.domain.replace(/^\./, '')
  return `${cookie.secure ? 'https' : 'http'}://${domain}${cookie.path || '/'}`
}

async function seedCookies(ses: Session, cookies: StoredSiteCookie[]): Promise<void> {
  for (const cookie of cookies) {
    if (!cookie.name || !cookie.domain) continue
    try {
      await ses.cookies.set({
        url: cookieUrl(cookie),
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path || '/',
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        expirationDate: cookie.expirationDate,
        sameSite: cookie.sameSite
      })
    } catch {
      // A single stale/malformed cookie must not block the usable cookies.
    }
  }
}

async function accountSession(groupId: string, account: SiteAccountConfig): Promise<Session> {
  const ses = session.fromPartition(accountPartition(groupId))
  const proxy = getProxy()
  if (proxy) await applyProxyToSession(ses, proxy)
  await seedCookies(ses, account.cookies)
  return ses
}

function appendFile(form: FormData, field: string, torrent: PoolEntry): void {
  const bytes = torrent.bytes.slice().buffer as ArrayBuffer
  form.append(field, new Blob([bytes], { type: 'application/x-bittorrent' }), torrent.fileName)
}

async function errorText(response: Response): Promise<string> {
  const raw = await response.text()
  if (!raw) return `HTTP ${response.status}`
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    const message = value.message ?? value.error ?? value.value ?? value.status
    return typeof message === 'string' ? message : raw.slice(0, 500)
  } catch {
    return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500)
  }
}

async function publishMikan(
  account: SiteAccountConfig,
  payload: LocalPublishPayload,
  torrent: PoolEntry
): Promise<SitePublishResult> {
  // Compute from the raw uploaded info dictionary, including retries restored without meta.
  const url = mikanEpisodeUrl(createHash('sha1').update(parseTorrent(torrent.bytes).infoRaw).digest('hex'))
  const body = buildMikanRequestBody({
    title: payload.title,
    torrentBase64: Buffer.from(torrent.bytes).toString('base64'),
    descriptionBbcode: formatDescription('mikan', payload.descriptionMd),
    bangumiId: payload.mikanBangumiId,
    subtitleGroupId: account.subtitleGroupId,
    publishGroupId: account.publishGroupId
  })
  const response = await net.fetch('https://api.mikanani.me/api/episode', {
    method: 'POST',
    headers: { Authorization: `MikanHash ${account.apiToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!response.ok) return { site: 'mikan', ok: false, error: await errorText(response), httpStatus: response.status }
  return { site: 'mikan', ok: true, url }
}

async function publishNyaa(
  account: SiteAccountConfig,
  payload: LocalPublishPayload,
  torrent: PoolEntry
): Promise<SitePublishResult> {
  // Nyaa's undocumented upload API, following Nyaapi: Basic Auth + torrent_data JSON + torrent.
  const form = new FormData()
  appendFile(form, 'torrent', torrent)
  form.append('torrent_data', JSON.stringify({
    name: payload.title,
    category: payload.nyaaCategory || '1_3',
    information: payload.nyaaInformation,
    description: formatDescription('nyaa', payload.descriptionMd),
    anonymous: account.anonymous,
    hidden: payload.nyaaHidden,
    complete: false,
    remake: payload.nyaaRemake,
    trusted: true
  }))
  const response = await net.fetch('https://nyaa.si/api/upload', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${account.username}:${account.password}`).toString('base64')}`,
      'User-Agent': account.userAgent || DEFAULT_UA
    },
    body: form
  })
  const raw = await response.text()
  if (response.ok) {
    try {
      const data = JSON.parse(raw) as Record<string, unknown>
      const directUrl = typeof data.url === 'string' ? data.url : ''
      const torrentData =
        typeof data.torrent === 'object' && data.torrent ? (data.torrent as Record<string, unknown>) : undefined
      const id = data.id ?? data.torrent_id ?? torrentData?.id
      return {
        site: 'nyaa',
        ok: true,
        url: directUrl || (id != null ? `https://nyaa.si/view/${id}` : 'https://nyaa.si/upload')
      }
    } catch {
      return { site: 'nyaa', ok: true, url: 'https://nyaa.si/upload' }
    }
  }
  return {
    site: 'nyaa',
    ok: false,
    error: raw.slice(0, 500) || `HTTP ${response.status}`,
    httpStatus: response.status
  }
}

async function findDmhyLink(ses: Session, title: string, origin: string, userAgent: string): Promise<string | undefined> {
  const urls = [
    `${origin}/topics/mlist/scope/team`,
    `${origin}/topics/list?keyword=${encodeURIComponent(title)}`
  ]
  for (let attempt = 0; attempt < 5; attempt++) {
    for (const url of urls) {
      const response = await ses.fetch(url, { headers: { 'User-Agent': userAgent } })
      const html = await response.text()
      const link = extractDmhyTopicLink(html, title, origin)
      if (link) return link
    }
    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  return undefined
}

async function publishDmhy(
  groupId: string,
  account: SiteAccountConfig,
  payload: LocalPublishPayload,
  torrent: PoolEntry
): Promise<SitePublishResult> {
  const ses = await accountSession(groupId, account)
  const userAgent = account.userAgent || DEFAULT_UA
  const context = await loadDmhyPublishContext((url) => ses.fetch(url, { headers: { 'User-Agent': userAgent } }), account.identityName)
  if (!context.ok) return { site: 'dmhy', ok: false, error: context.error }
  const html = formatDescription('dmhy', payload.descriptionMd)
  const poster = html.match(/<img[^>]+src="([^"]+)"/i)?.[1] ?? ''
  const form = new FormData()
  form.append('sort_id', '2')
  form.append('team_id', context.teamId)
  form.append('bt_data_title', payload.title)
  form.append('poster_url', poster)
  form.append('bt_data_intro', html)
  form.append('tracker', '')
  form.append('MAX_FILE_SIZE', '2097152')
  appendFile(form, 'bt_file', torrent)
  form.append('disable_download_seed_file', '0')
  form.append('emule_resource', '')
  form.append('synckey', '')
  form.append('submit', '提交')
  const response = await ses.fetch(context.url, {
    method: 'POST', body: form, headers: { 'User-Agent': userAgent, Referer: context.url }
  })
  const raw = await response.text()
  if (response.ok && (raw.includes('上傳成功') || raw.includes('種子已存在'))) {
    const origin = new URL(context.url).origin
    return {
      site: 'dmhy',
      ok: true,
      url: extractDmhyTopicLink(raw, payload.title, origin) ?? await findDmhyLink(ses, payload.title, origin, userAgent)
    }
  }
  return { site: 'dmhy', ok: false, error: raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 500), httpStatus: response.status }
}

async function publishAcgnx(
  site: 'acgnxAsia' | 'acgnxGlobal',
  account: SiteAccountConfig,
  payload: LocalPublishPayload,
  torrent: PoolEntry
): Promise<SitePublishResult> {
  const base = site === 'acgnxAsia' ? 'https://share.acgnx.se/' : 'https://www.acgnx.se/'
  const form = new FormData()
  form.append('mod', 'upload')
  form.append('sort_id', site === 'acgnxAsia' ? '1' : '4')
  appendFile(form, 'bt_file', torrent)
  form.append('title', payload.title)
  form.append('intro', formatDescription(site, payload.descriptionMd))
  form.append('discuss_url', '')
  form.append('Anonymous_Post', '0')
  form.append('Team_Post', '1')
  form.append('uid', account.uid)
  form.append('api_token', account.apiToken)
  const response = await net.fetch(`${base}user.php?o=api&op=upload`, { method: 'POST', body: form })
  const raw = await response.text()
  try {
    const result = JSON.parse(raw) as { code?: number | string; value?: string; infohash?: string }
    const code = Number(result.code)
    if ((code === 200 || code === 302) && result.infohash) {
      return { site, ok: true, url: `${base}show-${result.infohash}.html` }
    }
    return { site, ok: false, error: result.value || raw.slice(0, 500), httpStatus: response.status }
  } catch {
    return { site, ok: false, error: raw.replace(/<[^>]+>/g, ' ').slice(0, 500), httpStatus: response.status }
  }
}

async function publishBangumiMoe(
  groupId: string,
  account: SiteAccountConfig,
  payload: LocalPublishPayload,
  torrent: PoolEntry
): Promise<SitePublishResult> {
  const ses = await accountSession(groupId, account)
  const teamsResponse = await ses.fetch('https://bangumi.moe/api/team/myteam')
  const teams = (await teamsResponse.json()) as Array<{ _id?: string; name?: string }>
  const team = account.identityName ? teams.find((item) => item.name === account.identityName) : teams[0]
  if (!team?._id) return { site: 'bangumiMoe', ok: false, error: '未找到萌番组团队，请检查 Cookie 和团队名称' }
  const form = new FormData()
  form.append('category_tag_id', '549ef207fe682f7549f1ea90')
  form.append('title', payload.title)
  form.append('introduction', formatDescription('bangumiMoe', payload.descriptionMd))
  form.append('tag_ids', '')
  form.append('btskey', 'undefined')
  form.append('team_id', team._id)
  appendFile(form, 'file', torrent)
  const response = await ses.fetch('https://bangumi.moe/api/torrent/add', { method: 'POST', body: form })
  const raw = await response.text()
  try {
    const result = JSON.parse(raw) as { success?: boolean; torrent?: { _id?: string }; message?: string }
    if (result.success && result.torrent?._id) {
      return { site: 'bangumiMoe', ok: true, url: `https://bangumi.moe/torrent/${result.torrent._id}` }
    }
    const duplicate = result.message?.match(/torrent same as\s+(.+)/i)?.[1]
    if (duplicate) return { site: 'bangumiMoe', ok: true, url: `https://bangumi.moe/torrent/${duplicate}` }
    return { site: 'bangumiMoe', ok: false, error: result.message || raw.slice(0, 500) }
  } catch {
    return { site: 'bangumiMoe', ok: false, error: raw.slice(0, 500), httpStatus: response.status }
  }
}

async function publishAcgrip(
  account: SiteAccountConfig,
  payload: LocalPublishPayload,
  torrent: PoolEntry
): Promise<SitePublishResult> {
  const form = new FormData()
  form.append('post[category_id]', '1')
  form.append('post[series_id]', '0')
  appendFile(form, 'post[torrent]', torrent)
  form.append('post[title]', payload.title)
  form.append('post[content]', formatDescription('acgrip', payload.descriptionMd))
  const postAsTeam = acgripPostAsTeamValue(account)
  if (postAsTeam) form.append('post[post_as_team]', postAsTeam)
  const response = await net.fetch(account.apiUrl || 'https://acg.rip/api/post', {
    method: 'POST',
    headers: { 'X-API-TOKEN': normalizeAcgripToken(account.apiToken) },
    body: form
  })
  const raw = await response.text()
  try {
    const result = JSON.parse(raw) as { id?: number | string; error?: string; message?: string }
    if (response.ok && result.id != null) return { site: 'acgrip', ok: true, url: `https://acg.rip/t/${result.id}` }
    return { site: 'acgrip', ok: false, error: [result.error, result.message].filter(Boolean).join(': ') || raw.slice(0, 500), httpStatus: response.status }
  } catch {
    return { site: 'acgrip', ok: false, error: raw.slice(0, 500), httpStatus: response.status }
  }
}

async function publishOne(
  site: PublishSite,
  groupId: string,
  account: SiteAccountConfig,
  payload: LocalPublishPayload,
  torrent: PoolEntry
): Promise<SitePublishResult> {
  try {
    if (site === 'anibt') {
      if (payload.bgmId === null) return { site, ok: false, error: '启用 AniBT 时必须填写 bgmId' }
      let torrentToken = payload.torrentToken ?? ''
      let temporaryToken = ''
      if (!getTorrent(torrentToken)) {
        temporaryToken = addTorrent(torrent.fileName, torrent.bytes).token
        torrentToken = temporaryToken
      }
      try {
        const result = await anibt.publishRelease({
          torrentToken,
          animeIdType: 'bgm',
          animeId: String(payload.bgmId),
          title: payload.title,
          episodeKey: payload.episodeKey,
          resolution: payload.resolution,
          language: payload.language,
          subtitle: payload.subtitle,
          format: payload.format,
          version: payload.version,
          notes: payload.descriptionMd,
          preview: false,
          nyaa: false,
          nyaaCategory: '',
          apiKey: account.apiKey
        })
        return result.ok
          ? { site, ok: true, url: result.previewUrl || (result.releaseId ? `https://anibt.net/release/${result.releaseId}` : undefined) }
          : { site, ok: false, error: result.error?.message, httpStatus: result.error?.httpStatus }
      } finally {
        if (temporaryToken) removeTorrent(temporaryToken)
      }
    }
    if (site === 'mikan') return publishMikan(account, payload, torrent)
    if (site === 'nyaa') {
      const hasNyaaTracker = torrent.meta?.hasNyaaTracker ?? parseTorrent(torrent.bytes).hasNyaaTracker
      if (!hasNyaaTracker) {
        return { site, ok: false, error: 'Nyaa 发布要求种子包含 http://nyaa.tracker.wf:7777/announce' }
      }
      return publishNyaa(account, payload, torrent)
    }
    if (site === 'dmhy') return publishDmhy(groupId, account, payload, torrent)
    if (site === 'acgnxAsia' || site === 'acgnxGlobal') return publishAcgnx(site, account, payload, torrent)
    if (site === 'bangumiMoe') return publishBangumiMoe(groupId, account, payload, torrent)
    return publishAcgrip(account, payload, torrent)
  } catch (error) {
    return { site, ok: false, error: String(error) }
  }
}

export async function publishLocal(payload: LocalPublishPayload, data: AppData): Promise<LocalPublishResult> {
  const group = data.groups.find((item) => item.id === payload.groupId)
  if (!group) return { ok: false, sites: [], error: '发布组不存在' }
  const torrent = torrentFor(payload)
  if (!torrent) return { ok: false, sites: [], error: '种子已不在内存或重试缓存中，请重新添加文件' }
  archiveTorrent(payload.recordId, torrent)
  const results: SitePublishResult[] = []
  // Deliberately serial: public trackers rate-limit uploads and duplicate checks.
  for (const site of payload.sites) results.push(await publishOne(site, group.id, group.sites[site], payload, torrent))
  return { ok: results.length > 0 && results.every((result) => result.ok), sites: results }
}

export async function searchMikan(kind: MikanSearchKind, query: string): Promise<ApiResult<MikanSearchItem[]>> {
  const q = query.trim()
  if (!q) return { ok: true, data: [] }
  try {
    const response = await net.fetch(`https://api.mikanani.me/api/${kind}/search/${encodeURIComponent(q)}`)
    if (!response.ok) return { ok: false, error: await errorText(response) }
    return { ok: true, data: parseMikanSearchItems(kind, await response.json()) }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

export async function checkSite(site: PublishSite, account: SiteAccountConfig): Promise<SiteCheckResult> {
  const configurationError = siteConfigurationError(site, account)
  if (configurationError) return { ok: false, message: configurationError }
  try {
    if (site === 'anibt') {
      const result = await anibt.groupMe(account.apiKey)
      return result.ok && result.data
        ? { ok: true, message: '检查通过', identityName: result.data.name, slug: result.data.slug, scopes: result.data.scopes }
        : { ok: false, message: result.error ?? '检查失败' }
    }
    if (site === 'nyaa' && account.username.trim() && account.password) {
      // Nyaa 没有独立的 whoami。向上传 API 发送不含 torrent 的校验请求：
      // 正确凭据会进入字段校验，错误凭据会在 Basic Auth 层返回 401/403，不会创建种子。
      const probe = new FormData()
      probe.append('torrent_data', '{}')
      const response = await net.fetch('https://nyaa.si/api/upload', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${account.username}:${account.password}`).toString('base64')}`,
          'User-Agent': account.userAgent || DEFAULT_UA
        },
        body: probe
      })
      const raw = await response.text()
      const ok =
        response.status !== 401 &&
        response.status !== 403 &&
        !/invalid (?:username|password|credentials)|unauthorized/i.test(raw)
      return {
        ok,
        message: ok
          ? '账号认证通过'
          : raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) || `HTTP ${response.status}`
      }
    }
    if (site === 'mikan' || site === 'acgrip' || site === 'acgnxAsia' || site === 'acgnxGlobal') {
      return unavailableCredentialCheck(site)
    }
    if (site === 'dmhy') {
      const context = await loadDmhyPublishContext((url) => net.fetch(url, {
        headers: { 'User-Agent': account.userAgent || DEFAULT_UA, Cookie: dmhyCookieHeader(account.cookies, url) }
      }), account.identityName)
      return context.ok
        ? { ok: true, message: `检查通过：${context.identityName}` }
        : { ok: false, message: context.error }
    }
    const testUrl = SITE_TEST_URLS[site]
    if (!testUrl) return { ok: false, message: '该站点没有可用的检查接口' }
    const headers: Record<string, string> = { 'User-Agent': account.userAgent || DEFAULT_UA }
    if (account.cookies.length > 0) headers.Cookie = account.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
    const response = await net.fetch(testUrl, { method: 'GET', headers })
    const raw = await response.text()
    let ok = response.ok && !/not logged in|登入發佈系統|unauthorized|invalid token|認證失敗/i.test(raw)
    if (site === 'bangumiMoe') {
      try {
        const teams = JSON.parse(raw) as unknown
        ok = ok && Array.isArray(teams) && teams.length > 0
      } catch {
        ok = false
      }
    }
    return { ok, message: ok ? '检查通过' : raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300) || `HTTP ${response.status}` }
  } catch (error) {
    return { ok: false, message: String(error) }
  }
}

export async function testSiteConnection(site: PublishSite): Promise<SiteConnectionResult> {
  const started = Date.now()
  try {
    const response = await net.fetch(SITE_URLS[site], { method: 'HEAD' })
    return {
      site,
      ok: response.status < 500,
      latencyMs: Date.now() - started,
      error: response.status >= 500 ? `HTTP ${response.status}` : undefined
    }
  } catch (error) {
    return { site, ok: false, latencyMs: Date.now() - started, error: String(error) }
  }
}

export { LOGIN_URLS }
