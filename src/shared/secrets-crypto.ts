import crypto from 'node:crypto'
import { PUBLISH_SITES, type GroupAccount, type PublishSite } from './types.ts'

/**
 * secrets.json 的加解密核心：纯逻辑，不碰文件系统、不碰 Electron，node 直跑单测。
 * 文件 IO 在 src/main/secrets.ts。
 *
 * 方案（用户选定）：AES-256-GCM，密钥由应用内固定口令 + 固定盐 scrypt 派生，
 * 「随文件走」—— portable 单 exe 拷到任何机器都能解开，不绑定 OS 账户。
 * 代价：这是**混淆级**保护，能防明文泄露（截图 / 网盘同步 / 误提交仓库），
 * 防不住拿到 exe 逆向的人。别把它当密钥托管。
 *
 * 注意：本文件会被 node 以 type-stripping 方式直接执行，只能用可擦除 TS 语法。
 */

const KDF_PASSPHRASE = 'anibt-publish/secrets/v1'
const KDF_SALT = 'AniBT Publish::secrets::2026'
export const SECRETS_ALG = 'aes-256-gcm'

let cachedKey: Buffer | null = null

/** scrypt 有意慢，派生一次缓存住 */
function key(): Buffer {
  if (!cachedKey) cachedKey = crypto.scryptSync(KDF_PASSPHRASE, KDF_SALT, 32)
  return cachedKey
}

/** v1: groupId → AniBT apiKey；v2: groupId/site/field → JSON or string. */
export type SecretMap = Record<string, string>

export interface SecretsEnvelope {
  version: 1
  alg: string
  iv: string
  tag: string
  data: string
}

export function sealSecrets(map: SecretMap): SecretsEnvelope {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(SECRETS_ALG, key(), iv)
  const data = Buffer.concat([cipher.update(JSON.stringify(map), 'utf-8'), cipher.final()])
  return {
    version: 1,
    alg: SECRETS_ALG,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64')
  }
}

/**
 * 解封。任何异常（结构不对 / base64 坏 / GCM tag 不匹配 / JSON 坏）一律返回空表。
 * 绝不抛、绝不把内容写进日志。
 */
export function openSecrets(raw: unknown): SecretMap {
  try {
    if (typeof raw !== 'object' || raw === null) return {}
    const env = raw as Partial<SecretsEnvelope>
    if (env.alg !== SECRETS_ALG) return {}
    if (typeof env.iv !== 'string' || typeof env.tag !== 'string' || typeof env.data !== 'string') return {}
    const decipher = crypto.createDecipheriv(SECRETS_ALG, key(), Buffer.from(env.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(env.tag, 'base64'))
    const plain = Buffer.concat([
      decipher.update(Buffer.from(env.data, 'base64')),
      decipher.final()
    ]).toString('utf-8')
    const parsed: unknown = JSON.parse(plain)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const out: SecretMap = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && v.length > 0) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

const SITE_SECRET_FIELDS = ['apiKey', 'apiToken', 'username', 'password', 'cookies', 'userAgent'] as const

function secretKey(groupId: string, site: PublishSite, field: (typeof SITE_SECRET_FIELDS)[number]): string {
  return `${groupId}/${site}/${field}`
}

/** 从 AppData.groups 抽出所有站点敏感字段。 */
export function collectSecrets(groups: GroupAccount[]): SecretMap {
  const out: SecretMap = {}
  for (const g of groups) {
    for (const site of PUBLISH_SITES) {
      const account = g.sites[site]
      for (const field of SITE_SECRET_FIELDS) {
        if (site === 'nyaa' && field === 'cookies') continue
        const value = account[field]
        if (field === 'cookies') {
          if (value.length > 0) out[secretKey(g.id, site, field)] = JSON.stringify(value)
        } else if (typeof value === 'string' && value.length > 0) {
          out[secretKey(g.id, site, field)] = value
        }
      }
    }
  }
  return out
}

/** 把 secrets.json 合回清洗后的配置，兼容旧版 groupId → AniBT API Key。 */
export function mergeSecrets(groups: GroupAccount[], secrets: SecretMap): void {
  for (const group of groups) {
    const legacy = secrets[group.id]
    if (legacy) group.sites.anibt.apiKey = legacy
    for (const site of PUBLISH_SITES) {
      const account = group.sites[site]
      for (const field of SITE_SECRET_FIELDS) {
        if (site === 'nyaa' && field === 'cookies') continue
        const value = secrets[secretKey(group.id, site, field)]
        if (!value) continue
        if (field === 'cookies') {
          try {
            const parsed: unknown = JSON.parse(value)
            if (Array.isArray(parsed)) account.cookies = parsed as typeof account.cookies
          } catch {
            account.cookies = []
          }
        } else {
          account[field] = value
        }
      }
    }
  }
}

/** 生成可写入 config.json 的副本，确保敏感字段不落明文。 */
export function redactSecrets(groups: GroupAccount[]): GroupAccount[] {
  return groups.map((group) => ({
    ...group,
    sites: Object.fromEntries(
      PUBLISH_SITES.map((site) => [
        site,
        { ...group.sites[site], apiKey: '', apiToken: '', username: '', password: '', cookies: [], userAgent: '' }
      ])
    ) as unknown as GroupAccount['sites']
  }))
}
