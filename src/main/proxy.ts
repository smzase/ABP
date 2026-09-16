import { session, type Session } from 'electron'
import type { ProxySettings } from '../shared/types.ts'

/**
 * 代理：走 Chromium net stack（session.setProxy），天然支持 HTTP / HTTPS / SOCKS5 / 系统代理。
 * 所有 AniBT API 调用都经由 net.fetch，因此天然继承这里设置的代理。
 */

let current: ProxySettings | null = null

function apiSession(): Session {
  return session.defaultSession
}

export async function applyProxy(proxy: ProxySettings): Promise<void> {
  current = proxy
  const ses = apiSession()
  if (proxy.mode === 'system') {
    await ses.setProxy({ mode: 'system' })
  } else if (proxy.mode === 'direct') {
    await ses.setProxy({ mode: 'direct' })
  } else {
    const scheme = proxy.type === 'SOCKS5' ? 'socks5' : proxy.type.toLowerCase()
    await ses.setProxy({
      mode: 'fixed_servers',
      proxyRules: `${scheme}://${proxy.host}:${proxy.port}`,
      proxyBypassRules: '<-loopback>'
    })
  }
}

export function getProxy(): ProxySettings | null {
  return current
}

/** 代理认证：在 app 的 login 事件里调用 */
export function provideProxyCredentials(
  authInfo: Electron.AuthInfo,
  callback: (username?: string, password?: string) => void
): boolean {
  if (authInfo.isProxy && current?.mode === 'custom' && current.username) {
    callback(current.username, current.password)
    return true
  }
  return false
}
