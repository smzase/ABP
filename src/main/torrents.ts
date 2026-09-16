import crypto from 'node:crypto'
import { normalizeTorrentTrackers, parseTorrent } from '../shared/bencode.ts'
import { parseFileName } from '../shared/parse-name.ts'
import type { TorrentMeta } from '../shared/types.ts'

/**
 * 种子字节内存池：渲染进程把 .torrent 字节送进来，解析后凭 token 取回。
 * 不落地磁盘；条目随条目移除/应用退出释放。
 */
interface PoolEntry {
  fileName: string
  bytes: Uint8Array
  meta: TorrentMeta
}

const pool = new Map<string, PoolEntry>()

export function addTorrent(fileName: string, bytes: Uint8Array): TorrentMeta {
  // AniBT 最多接受 50 个 tracker。只规范化内存中的上传副本，不碰用户磁盘文件；
  // normalizeTorrentTrackers 保留 info 字典原始字节，因此 info hash 不变。
  const uploadBytes = normalizeTorrentTrackers(bytes)
  const info = parseTorrent(uploadBytes)
  const infoHashHex = crypto.createHash('sha1').update(info.infoRaw).digest('hex')
  const token = crypto.randomUUID()
  const meta: TorrentMeta = {
    token,
    fileName,
    innerName: info.innerName,
    infoHashHex,
    totalSize: info.totalSize,
    trackers: info.trackers,
    hasNyaaTracker: info.hasNyaaTracker,
    parsed: parseFileName(info.innerName || fileName)
  }
  pool.set(token, { fileName, bytes: uploadBytes, meta })
  return meta
}

export function getTorrent(token: string): PoolEntry | null {
  return pool.get(token) ?? null
}

export function removeTorrent(token: string): void {
  pool.delete(token)
}
