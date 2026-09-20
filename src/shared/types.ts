/**
 * 领域模型 + IPC 契约。
 * 注意：本目录（src/shared）会被 node 直接以 type-stripping 方式执行（scripts/run-checks.mjs），
 * 只能用「可擦除」TS 语法 —— 禁止 enum / namespace / 参数属性。
 */

import type { DashboardMenuAction, DashboardMenuRequest, DashboardMenuSettings } from './dashboard-menu.ts'
import type { DashboardNavigationAction, DashboardNavigationState } from './dashboard-navigation.ts'

// ---------- 枚举（const 对象 + 联合类型） ----------

/** 字幕类型：外挂 / 内封 / 内嵌 / 无字幕。值与 AniBT 发布接口对齐 */
export const SUBTITLE_TYPES = ['EXTERNAL', 'EMBEDDED', 'INTERNAL', 'NONE'] as const
export type SubtitleType = (typeof SUBTITLE_TYPES)[number]

/** 字幕语言代码（CHS 简 / CHT 繁 / JP 日 / EN 英 …） */
export const LANGUAGE_CODES = ['CHS', 'CHT', 'JP', 'EN'] as const
export type LanguageCode = string

export const RESOLUTIONS = ['360p', '480p', '720p', '1080p', '2160p', '4K'] as const
export type Resolution = string

export const VIDEO_FORMATS = ['MKV', 'MP4', 'AVI', 'WEBM'] as const
export type VideoFormat = string

export type ThemeMode = 'light' | 'dark'
export type Locale = 'zh-CN' | 'zh-TW' | 'en'
export type PublishMode = 'anibt' | 'local'

export const PUBLISH_SITES = [
  'anibt',
  'mikan',
  'nyaa',
  'dmhy',
  'acgnxAsia',
  'acgnxGlobal',
  'bangumiMoe',
  'acgrip'
] as const
export type PublishSite = (typeof PUBLISH_SITES)[number]
export type DescriptionFormat = 'markdown' | 'html' | 'bbcode'

// ---------- 设置 ----------

export interface ProxySettings {
  /** system=跟随系统；direct=直连；custom=手动 */
  mode: 'system' | 'direct' | 'custom'
  type: 'HTTP' | 'HTTPS' | 'SOCKS5'
  host: string
  port: number
  username: string
  password: string
}

export interface AppearanceSettings {
  mode: ThemeMode
  /** 本机字体家族名；空字符串使用系统默认字体。 */
  fontFamily: string
  /** 主题色（hex），默认 #fb7299 */
  accent: string
}

/** 字幕识别规则：命中 word（忽略大小写、包含匹配）→ 计入 langs 与字幕类型 */
export interface SubtitleDetectRule {
  word: string
  langs: LanguageCode[]
  type: SubtitleType | null
}

export interface SubtitleDetectSettings {
  rules: SubtitleDetectRule[]
  /** 已合并到用户规则中的客户端预设版本。 */
  presetVersion: number
}

export interface Settings {
  appearance: AppearanceSettings
  locale: Locale
  proxy: ProxySettings
  subtitleDetect: SubtitleDetectSettings
  sidebarCollapsed: boolean
  /** 主发布始终是 AniBT；local 是用户显式切换的备用本地直发。 */
  publishMode: PublishMode
}

// ---------- 站点账号（组） ----------

export interface StoredSiteCookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  expirationDate?: number
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
}

/** 不同站点只使用与其认证方式有关的字段。 */
export interface SiteAccountConfig {
  enabled: boolean
  apiKey: string
  apiUrl: string
  apiToken: string
  uid: string
  username: string
  password: string
  cookies: StoredSiteCookie[]
  userAgent: string
  /** 动漫花园/萌番组的发布身份或团队名。 */
  identityName: string
  /** Nyaa 直发是否匿名。 */
  anonymous: boolean
  /** ACG.RIP 是否以当前账号所属联盟身份发布。 */
  publishAsTeam: boolean
  subtitleGroupId: number | null
  subtitleGroupName: string
  publishGroupId: number | null
  publishGroupName: string
  slug: string
  scopes: string[]
  status: string
  lastCheckedAt: number | null
}

export type SiteAccounts = Record<PublishSite, SiteAccountConfig>

export type AnibtWebAccount = Pick<SiteAccountConfig, 'username' | 'password' | 'cookies' | 'userAgent'>

export interface GroupAccount {
  id: string
  name: string
  sites: SiteAccounts
}

// ---------- 模板 ----------

export interface TitleTemplate {
  id: string
  name: string
  template: string
}

export interface DescTemplate {
  id: string
  name: string
  markdown: string
}

/** 标题模板三变体 */
export type TitleVariant = 'simp' | 'trad' | 'both'

export interface AnimeNames {
  zh: string
  zhTw: string
  romaji: string
  en: string
  native: string
}

/** 番剧模板中的单个种子名示例及可手工修正的发布 profile。 */
export interface AnimeFilenameExample {
  fileName: string
  languages: LanguageCode[]
  subtitleType: SubtitleType | null
  resolution: string
  format: string
  codec: string
  bitDepth: string
  audioCodec: string
  source: string
}

/** 三类常见字幕发布方式的示例。示例本身不是字幕组白名单。 */
export interface AnimeFilenameExamples {
  simpInternal: AnimeFilenameExample
  tradInternal: AnimeFilenameExample
  embedded: AnimeFilenameExample
}

export interface AnimeTemplate {
  id: string
  /** 必填 */
  bgmId: number | null
  /** Mikan 自有 Bangumi ID，与 bgm.tv subject id 无关。 */
  mikanBangumiId: number | null
  names: AnimeNames
  customTags: string[]
  /** 必选：发布用组（GroupAccount.id） */
  groupId: string
  /** 每次发布默认启用 Nyaa 代发 */
  nyaaProxy: boolean
  nyaaInformation: string
  nyaaHidden: boolean
  nyaaRemake: boolean
  /** 繁体标题变体是否将中文标题与字幕标签转换为繁体字 */
  traditionalizeTitle: boolean
  titleTemplates: Record<TitleVariant, string>
  descriptionMd: string
  filenameExamples: AnimeFilenameExamples
  createdAt: number
  updatedAt: number
}

// ---------- 发布记录 ----------

export interface PublishRecord {
  id: string
  releaseId: string
  title: string
  bgmId: number | null
  animeName: string
  episodeKey: string
  groupId: string
  groupName: string
  resolution: string
  format: string
  languages: LanguageCode[]
  subtitle: SubtitleType
  version: string
  preview: boolean
  nyaa: boolean
  publishedAt: number
  /** ok=成功；deleted=已删除；failed=发布失败 */
  status: 'ok' | 'deleted' | 'failed'
  message?: string
  mode: PublishMode
  torrentFileName: string
  descriptionMd: string
  mikanBangumiId: number | null
  nyaaCategory: string
  nyaaInformation: string
  nyaaHidden: boolean
  nyaaRemake: boolean
  siteResults: SitePublishResult[]
}

// ---------- 应用数据文档（落盘 config.json） ----------

export interface AppData {
  version: 1
  anibtWebAccount: AnibtWebAccount
  settings: Settings
  groups: GroupAccount[]
  titleTemplates: TitleTemplate[]
  descTemplates: DescTemplate[]
  defaultTitleTemplateId: string | null
  defaultDescTemplateId: string | null
  animeTemplates: AnimeTemplate[]
  records: PublishRecord[]
}

// ---------- 种子解析 ----------

export interface ParsedName {
  episode: string | null
  resolution: string | null
  codec: string | null
  bitDepth: string | null
  audioCodec: string | null
  source: string | null
  format: string | null
  version: string | null
  languages: LanguageCode[]
  subtitleType: SubtitleType | null
}

export interface TorrentMeta {
  /** 内存池句柄，发布时凭它取回字节 */
  token: string
  fileName: string
  innerName: string
  infoHashHex: string
  totalSize: number
  trackers: string[]
  hasNyaaTracker: boolean
  parsed: ParsedName
}

// ---------- AniBT API ----------

export interface WhoamiResult {
  groupId: string
  groupName: string
  groupSlug: string
  scopes: string[]
  kind: string
}

export interface GroupMeResult {
  name: string
  slug: string
  status: string
  scopes: string[]
  stats?: { totalReleases?: number; totalAnimes?: number }
}

export interface BgmSearchItem {
  bgmId: number
  name: string
  nameCn: string
  date: string | null
  image: string
  rating: number | null
  totalEpisodes: number | null
  url: string
}

/** Bangumi 条目详情中可用于标题模板的名称。 */
export interface BgmAnimeDetails {
  bgmId: number
  name: string
  nameCn: string
  romaji: string
  en: string
}

export interface PublishPayload {
  /** 种子内存池 token */
  torrentToken: string
  animeIdType: 'bgm' | 'anilist' | 'mal' | 'anidb'
  animeId: string
  title: string
  episodeKey: string
  resolution: string
  language: LanguageCode[]
  subtitle: SubtitleType
  format: string
  version: string
  notes: string
  preview: boolean
  nyaa: boolean
  nyaaCategory: string
  /** 发布用 API Key（来自所选组） */
  apiKey: string
}

export interface PublishResult {
  ok: boolean
  releaseId?: string
  previewUrl?: string
  matchStatus?: string
  fileSize?: number
  error?: { code?: string; message: string; httpStatus?: number }
}

export interface SitePublishResult {
  site: PublishSite
  ok: boolean
  url?: string
  error?: string
  httpStatus?: number
}

export interface LocalPublishPayload {
  recordId: string
  torrentToken?: string
  torrentFileName: string
  groupId: string
  sites: PublishSite[]
  title: string
  episodeKey: string
  resolution: string
  format: string
  subtitle: SubtitleType
  language: LanguageCode[]
  version: string
  descriptionMd: string
  bgmId: number | null
  mikanBangumiId: number | null
  nyaaCategory: string
  nyaaInformation: string
  nyaaHidden: boolean
  nyaaRemake: boolean
}

export interface LocalPublishResult {
  ok: boolean
  sites: SitePublishResult[]
  error?: string
}

export interface MikanSearchItem {
  /** Mikan 自有番剧 ID。 */
  id: number
  name: string
  secondaryName?: string
  /** 搜索结果关联的 bgm.tv subject id；只有番剧搜索会提供。 */
  bgmId?: number
}

export type MikanSearchKind = 'bangumi' | 'subtitleGroup' | 'publishGroup'

export interface SiteCheckResult {
  ok: boolean
  message: string
  /** false 表示只能确认配置完整，站点没有无副作用的独立凭据验证接口。 */
  verified?: boolean
  identityName?: string
  slug?: string
  scopes?: string[]
}

export interface SiteLoginResult {
  ok: boolean
  cookies: StoredSiteCookie[]
  userAgent: string
  message?: string
}

export interface SiteCaptchaResult {
  ok: boolean
  dataUrl?: string
  message?: string
}

export interface SiteConnectionResult {
  site: PublishSite
  ok: boolean
  latencyMs?: number
  error?: string
}

/** 主窗口内嵌 AniBT 页面在渲染进程视口中的位置。 */
export interface DashboardBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface DeleteResult {
  ok: boolean
  state?: 'pending' | 'completed' | 'failed'
  error?: string
}

export interface ApiResult<T> {
  ok: boolean
  data?: T
  error?: string
}

// ---------- IPC 契约 ----------

export interface IpcChannels {
  'store:load': () => Promise<AppData>
  'store:save': (data: AppData) => Promise<void>
  'store:openDir': () => Promise<string>
  'store:getDir': () => Promise<string>
  'store:pickDir': () => Promise<string | null>
  'store:changeDir': (directory: string, data: AppData) => Promise<string>
  'system:listFonts': () => Promise<string[]>
  'window:minimize': () => Promise<void>
  'window:toggleMaximize': () => Promise<void>
  'window:close': () => Promise<void>
  'dialog:pickTorrents': () => Promise<TorrentMeta[]>
  'torrent:addBytes': (fileName: string, bytes: Uint8Array) => Promise<TorrentMeta>
  'torrent:remove': (token: string) => Promise<void>
  'anibt:whoami': (apiKey: string) => Promise<ApiResult<WhoamiResult>>
  'anibt:groupMe': (apiKey: string) => Promise<ApiResult<GroupMeResult>>
  'anibt:bgmSearch': (q: string, limit?: number) => Promise<ApiResult<BgmSearchItem[]>>
  'anibt:bgmDetails': (bgmId: number) => Promise<ApiResult<BgmAnimeDetails>>
  'anibt:publish': (payload: PublishPayload) => Promise<PublishResult>
  'anibt:deleteRelease': (apiKey: string, releaseId: string) => Promise<DeleteResult>
  'anibt:deletionStatus': (apiKey: string, releaseId: string) => Promise<DeleteResult>
  'anibt:webLogin': (account: AnibtWebAccount, themeMode: ThemeMode, bounds: DashboardBounds) => Promise<SiteLoginResult>
  'anibt:cancelWebLogin': () => Promise<void>
  'anibt:setWebLoginBounds': (bounds: DashboardBounds) => Promise<void>
  'anibt:webCheck': () => Promise<SiteLoginResult>
  'anibt:webLogout': (clearAll: boolean) => Promise<void>
  /** 主窗口内嵌网页，没有 preload 或 Node.js 权限。 */
  'anibt:openDashboard': (bounds: DashboardBounds, themeMode: ThemeMode) => Promise<void>
  'anibt:setDashboardBounds': (bounds: DashboardBounds) => Promise<void>
  'anibt:setDashboardVisible': (visible: boolean) => Promise<void>
  'anibt:showDashboardMenu': (request: DashboardMenuRequest) => Promise<boolean>
  'anibt:hideDashboardMenu': (id?: string) => Promise<void>
  'anibt:updateDashboardMenu': (settings: DashboardMenuSettings) => Promise<void>
  'anibt:dashboardMenuPainted': (id: string, size: { width: number; height: number }) => Promise<void>
  'anibt:dashboardMenuHidden': (id: string) => Promise<void>
  'anibt:dashboardMenuAction': (id: string, action: DashboardMenuAction) => Promise<void>
  'anibt:reloadDashboard': () => Promise<void>
  'anibt:dashboardNavigationState': () => Promise<DashboardNavigationState>
  'anibt:navigateDashboard': (action: DashboardNavigationAction) => Promise<void>
  'anibt:setWebLocale': (locale: Locale) => Promise<void>
  'anibt:setDashboardTheme': (themeMode: ThemeMode) => Promise<void>
  'anibt:closeDashboard': () => Promise<void>
  'local:publish': (payload: LocalPublishPayload) => Promise<LocalPublishResult>
  'local:removeArchive': (recordId: string) => Promise<void>
  'site:login': (groupId: string, site: PublishSite, account: SiteAccountConfig, captchaCode: string) => Promise<SiteLoginResult>
  'site:openLogin': (groupId: string, site: PublishSite, account: SiteAccountConfig) => Promise<SiteLoginResult>
  'site:dmhyCaptcha': (groupId: string, account: SiteAccountConfig) => Promise<SiteCaptchaResult>
  'site:clearCookies': (groupId: string, site: PublishSite) => Promise<void>
  'site:check': (site: PublishSite, account: SiteAccountConfig) => Promise<SiteCheckResult>
  'mikan:search': (kind: MikanSearchKind, query: string) => Promise<ApiResult<MikanSearchItem[]>>
  'proxy:apply': (proxy: ProxySettings) => Promise<void>
  'proxy:testSite': (site: PublishSite) => Promise<SiteConnectionResult>
  'zhconvert:traditional': (text: string) => Promise<ApiResult<string>>
}
