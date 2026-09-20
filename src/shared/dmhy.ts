import MarkdownIt from 'markdown-it'
import type { StoredSiteCookie } from './types.ts'

// Match the host used by credential/CAPTCHA login. Older manual sessions may use share.
export const DMHY_ORIGINS = ['https://www.dmhy.org', 'https://share.dmhy.org'] as const
const htmlUtils = new MarkdownIt().utils

export interface DmhyIdentity {
  id: string
  name: string
  selected: boolean
}

function decodeHtml(value: string): string {
  // Decode entities only; identity names are HTML, not Markdown escapes.
  return value.replace(/&(?:#x[\da-f]+|#\d+|[a-z][\da-z]+);/gi, (entity) => htmlUtils.unescapeAll(entity))
}

function attributes(source: string): Map<string, string> {
  const values = new Map<string, string>()
  for (const match of source.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    values.set(match[1].toLowerCase(), decodeHtml(match[2] ?? match[3] ?? match[4] ?? ''))
  }
  return values
}

function normalizedName(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** Only read the publishing identity select; sort/category selects also have numeric IDs. */
export function parseDmhyIdentities(html: string): DmhyIdentity[] {
  const source = html.replace(/<!--[\s\S]*?-->|<(script|style|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
  for (const select of source.matchAll(/<select\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/select\s*>/gi)) {
    const attrs = attributes(select[1])
    if (attrs.get('name') !== 'team_id' && attrs.get('id') !== 'team_id') continue
    if (attrs.has('disabled')) return []
    const identities: DmhyIdentity[] = []
    for (const option of select[2].matchAll(/<option\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)(?=<\/option\s*>|<option\b|$)/gi)) {
      const optionAttrs = attributes(option[1])
      const id = optionAttrs.get('value') ?? ''
      const name = (optionAttrs.get('label') || decodeHtml(option[2].replace(/<[^>]*>/g, ''))).replace(/\s+/g, ' ').trim()
      if (/^\d+$/.test(id) && name && !optionAttrs.has('disabled')) {
        identities.push({ id, name, selected: optionAttrs.has('selected') })
      }
    }
    return identities
  }
  return []
}

export function selectDmhyIdentity(identities: DmhyIdentity[], expected: string): DmhyIdentity | undefined {
  const name = normalizedName(expected)
  return name
    ? identities.find((identity) => normalizedName(identity.name) === name)
    : identities.find((identity) => identity.selected) ?? identities[0]
}

function decodeText(value: string): string {
  const named: Record<string, string> = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"' }
  return value.replace(/&(?:#x([\da-f]+)|#(\d+)|([a-z][\da-z]+));/gi, (entity, hex: string, decimal: string, name: string) => {
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16))
    if (decimal) return String.fromCodePoint(Number(decimal))
    return named[name.toLowerCase()] ?? entity
  })
}

function titleKey(value: string): string {
  return decodeText(value.replace(/<[^>]*>/g, ' ')).normalize('NFKC').replace(/[\s\u200b]+/g, '').toLocaleLowerCase()
}

/** Extract a published topic link from DMHY's result/list pages. */
export function extractDmhyTopicLink(html: string, expectedTitle: string, origin: string): string | undefined {
  const expected = titleKey(expectedTitle)
  if (!expected) return undefined
  const candidates: Array<{ url: string; title: string; score: number }> = []
  for (const anchor of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const href = anchor[1].match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2]
    if (!href || !/\/topics\/(?:view|edit)\//i.test(href)) continue
    const text = decodeText(anchor[2]).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    const key = titleKey(text)
    if (!key) continue
    const score = key === expected ? 3 : key.includes(expected) || expected.includes(key) ? 1 : 0
    if (score > 0) candidates.push({ url: new URL(href, origin).toString(), title: text, score })
  }
  return candidates.sort((a, b) => b.score - a.score || a.title.length - b.title.length)[0]?.url
}

/** Account checks must obey the same Cookie host/path/expiry rules as the publish Session. */
export function dmhyCookieHeader(cookies: StoredSiteCookie[], target: string, now = Date.now() / 1000): string {
  const url = new URL(target)
  if (!(DMHY_ORIGINS as readonly string[]).includes(url.origin)) return ''
  return cookies.filter((cookie) => {
    const domain = cookie.domain.toLowerCase().replace(/^\./, '')
    const domainMatches = url.hostname === domain || (cookie.domain.startsWith('.') && url.hostname.endsWith(`.${domain}`))
    const cookiePath = cookie.path || '/'
    const pathMatches = url.pathname === cookiePath || url.pathname.startsWith(cookiePath.endsWith('/') ? cookiePath : `${cookiePath}/`)
    return domainMatches && pathMatches && (cookie.expirationDate == null || cookie.expirationDate > now)
  }).map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
}
