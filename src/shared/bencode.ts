/**
 * 极简 bencode 解码器（只支持种子文件需要的类型）。
 * 每个循环读字节前都做边界检查 —— 畸形输入（声明超长字符串、截断、垃圾字节）
 * 必须抛异常而不是越界死循环。
 */

export type BValue = number | Uint8Array | BValue[] | { [key: string]: BValue }

const te = new TextDecoder()
const utf8Encoder = new TextEncoder()

function fail(msg: string, pos: number): never {
  throw new Error(`bencode: ${msg} (at ${pos})`)
}

export function bdecode(data: Uint8Array): BValue {
  let pos = 0

  function peek(): number {
    if (pos >= data.length) fail('unexpected end of input', pos)
    return data[pos]
  }

  function decode(): BValue {
    const c = peek()
    if (c === 0x69 /* i */) return decodeInt()
    if (c === 0x6c /* l */) return decodeList()
    if (c === 0x64 /* d */) return decodeDict()
    if (c >= 0x30 && c <= 0x39) return decodeBytes()
    fail(`invalid byte 0x${c.toString(16)}`, pos)
  }

  function decodeInt(): number {
    pos++ // 'i'
    const end = data.indexOf(0x65 /* e */, pos)
    if (end < 0) fail('unterminated integer', pos)
    const s = te.decode(data.subarray(pos, end))
    if (!/^-?\d+$/.test(s)) fail(`bad integer "${s}"`, pos)
    pos = end + 1
    return Number(s)
  }

  function decodeBytes(): Uint8Array {
    let len = 0
    while (pos < data.length) {
      const c = data[pos]
      if (c === 0x3a /* : */) break
      if (c < 0x30 || c > 0x39) fail('bad string length', pos)
      len = len * 10 + (c - 0x30)
      if (len > data.length) fail('declared string longer than input', pos)
      pos++
    }
    if (pos >= data.length || data[pos] !== 0x3a) fail('missing ":"', pos)
    pos++
    if (pos + len > data.length) fail('string overruns input', pos)
    const out = data.subarray(pos, pos + len)
    pos += len
    return out
  }

  function decodeList(): BValue[] {
    pos++ // 'l'
    const out: BValue[] = []
    for (;;) {
      if (pos >= data.length) fail('unterminated list', pos)
      if (data[pos] === 0x65) {
        pos++
        return out
      }
      out.push(decode())
    }
  }

  function decodeDict(): { [key: string]: BValue } {
    pos++ // 'd'
    const out: { [key: string]: BValue } = Object.create(null)
    for (;;) {
      if (pos >= data.length) fail('unterminated dict', pos)
      if (data[pos] === 0x65) {
        pos++
        return out
      }
      const key = decodeBytes()
      out[te.decode(key)] = decode()
    }
  }

  const v = decode()
  return v
}

function asStr(v: BValue | undefined): string {
  return v instanceof Uint8Array ? te.decode(v) : ''
}

export interface TorrentInfo {
  innerName: string
  trackers: string[]
  hasNyaaTracker: boolean
  totalSize: number
  /** info 字典的原始字节（算 infoHash 用） */
  infoRaw: Uint8Array
}

const NYAA_TRACKER_HOST = 'nyaa.tracker.wf'
const ANIBT_TRACKER_HOST = 'tracker.anibt.net'

/** AniBT 的发布接口会拒绝从种子提取出超过 50 个 tracker 的请求。 */
export const TORRENT_TRACKER_LIMIT = 50

/** 从种子字节提取发布所需信息。畸形输入抛异常。 */
export function parseTorrent(data: Uint8Array): TorrentInfo {
  if (data.length === 0) throw new Error('bencode: empty input')
  const root = bdecode(data)
  if (typeof root !== 'object' || root === null || Array.isArray(root) || root instanceof Uint8Array) {
    throw new Error('bencode: torrent root must be a dict')
  }
  const info = root['info']
  if (typeof info !== 'object' || info === null || Array.isArray(info) || info instanceof Uint8Array) {
    throw new Error('bencode: torrent missing info dict')
  }

  // info 原始字节：重新定位 "4:info" 后的 bencode 片段。
  // 顶层 dict 里 info 通常是最后一个 key，但为了稳妥用扫描定位。
  const infoRaw = sliceInfoRaw(data)

  const trackers: string[] = []
  const announce = asStr(root['announce'])
  if (announce) trackers.push(announce)
  const announceList = root['announce-list']
  if (Array.isArray(announceList)) {
    for (const tier of announceList) {
      if (!Array.isArray(tier)) continue
      for (const url of tier) {
        const s = asStr(url)
        if (s && !trackers.includes(s)) trackers.push(s)
      }
    }
  }

  let totalSize = 0
  const length = info['length']
  if (typeof length === 'number') {
    totalSize = length
  } else {
    const files = info['files']
    if (Array.isArray(files)) {
      for (const f of files) {
        if (typeof f === 'object' && f !== null && !Array.isArray(f) && !(f instanceof Uint8Array)) {
          const l = f['length']
          if (typeof l === 'number') totalSize += l
        }
      }
    }
  }

  return {
    innerName: asStr(info['name']),
    trackers,
    hasNyaaTracker: trackers.some((t) => t.includes(NYAA_TRACKER_HOST)),
    totalSize,
    infoRaw
  }
}

interface ByteStringSpan {
  dataStart: number
  dataEnd: number
  next: number
}

interface TopLevelEntry {
  key: string
  valueStart: number
  valueEnd: number
}

function readByteStringSpan(data: Uint8Array, start: number): ByteStringSpan {
  let pos = start
  let len = 0
  if (pos >= data.length || data[pos] < 0x30 || data[pos] > 0x39) {
    fail('expected byte string', pos)
  }
  while (pos < data.length && data[pos] !== 0x3a) {
    const c = data[pos]
    if (c < 0x30 || c > 0x39) fail('bad string length', pos)
    len = len * 10 + (c - 0x30)
    if (len > data.length) fail('declared string longer than input', pos)
    pos++
  }
  if (pos >= data.length) fail('missing ":"', pos)
  const dataStart = pos + 1
  const dataEnd = dataStart + len
  if (dataEnd > data.length) fail('string overruns input', dataStart)
  return { dataStart, dataEnd, next: dataEnd }
}

function skipValue(data: Uint8Array, start: number): number {
  if (start >= data.length) fail('unexpected end of input', start)
  const c = data[start]
  if (c >= 0x30 && c <= 0x39) return readByteStringSpan(data, start).next
  if (c === 0x69) {
    const end = data.indexOf(0x65, start + 1)
    if (end < 0) fail('unterminated integer', start)
    return end + 1
  }
  if (c === 0x6c || c === 0x64) {
    const isDict = c === 0x64
    let pos = start + 1
    for (;;) {
      if (pos >= data.length) fail('unterminated container', pos)
      if (data[pos] === 0x65) return pos + 1
      if (isDict) pos = readByteStringSpan(data, pos).next
      pos = skipValue(data, pos)
    }
  }
  fail(`invalid byte 0x${c.toString(16)}`, start)
}

function scanTopLevelEntries(data: Uint8Array): TopLevelEntry[] {
  if (data[0] !== 0x64) fail('torrent root must be a dict', 0)
  const entries: TopLevelEntry[] = []
  let pos = 1
  for (;;) {
    if (pos >= data.length) fail('unterminated torrent root', pos)
    if (data[pos] === 0x65) return entries
    const keySpan = readByteStringSpan(data, pos)
    const valueStart = keySpan.next
    const valueEnd = skipValue(data, valueStart)
    entries.push({
      key: te.decode(data.subarray(keySpan.dataStart, keySpan.dataEnd)),
      valueStart,
      valueEnd
    })
    pos = valueEnd
  }
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

function encodeByteString(value: string): Uint8Array {
  const bytes = utf8Encoder.encode(value)
  return concatBytes([utf8Encoder.encode(`${bytes.length}:`), bytes])
}

function encodeAnnounceList(trackers: string[]): Uint8Array {
  const chunks: Uint8Array[] = [utf8Encoder.encode('l')]
  for (const tracker of trackers) {
    chunks.push(utf8Encoder.encode('l'), encodeByteString(tracker), utf8Encoder.encode('e'))
  }
  chunks.push(utf8Encoder.encode('e'))
  return concatBytes(chunks)
}

function selectTrackers(trackers: string[]): string[] {
  const selected: string[] = []
  const add = (tracker: string): void => {
    if (selected.length < TORRENT_TRACKER_LIMIT && !selected.includes(tracker)) selected.push(tracker)
  }

  // announce 保持第一；AniBT/Nyaa 即使位于长列表尾部也不能被截掉。
  add(trackers[0])
  for (const tracker of trackers) {
    if (tracker.includes(ANIBT_TRACKER_HOST) || tracker.includes(NYAA_TRACKER_HOST)) add(tracker)
  }
  for (const tracker of trackers) add(tracker)
  return selected
}

/**
 * 限制发布副本里的 tracker 数量，不修改磁盘文件。
 * 只替换顶层 announce / announce-list 的值，其余字节（尤其 info 字典）原样复制，
 * 因而不会改变 info hash。
 */
export function normalizeTorrentTrackers(data: Uint8Array): Uint8Array {
  const info = parseTorrent(data)
  if (info.trackers.length <= TORRENT_TRACKER_LIMIT) return data

  const trackers = selectTrackers(info.trackers)
  const entries = scanTopLevelEntries(data)
  const hasAnnounce = entries.some((entry) => entry.key === 'announce')
  const chunks: Uint8Array[] = []
  let cursor = 0

  for (const entry of entries) {
    chunks.push(data.subarray(cursor, entry.valueStart))
    if (entry.key === 'announce') {
      chunks.push(encodeByteString(trackers[0]))
    } else if (entry.key === 'announce-list') {
      // announce 已占一个名额，列表不再重复它，服务端无论是否去重都不会超过上限。
      chunks.push(encodeAnnounceList(hasAnnounce ? trackers.slice(1) : trackers))
    } else {
      chunks.push(data.subarray(entry.valueStart, entry.valueEnd))
    }
    cursor = entry.valueEnd
  }
  chunks.push(data.subarray(cursor))
  return concatBytes(chunks)
}

/** 定位并切出 info 字典的原始 bencode 字节 */
function sliceInfoRaw(data: Uint8Array): Uint8Array {
  const needle = new TextEncoder().encode('4:info')
  outer: for (let i = 0; i + needle.length <= data.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (data[i + j] !== needle[j]) continue outer
    }
    const start = i + needle.length
    // 从 start 解码一次，算出这段值占用的字节数
    let pos = start
    const skip = (): void => {
      if (pos >= data.length) throw new Error('bencode: truncated info')
      const c = data[pos]
      if (c === 0x69) {
        const end = data.indexOf(0x65, pos)
        if (end < 0) throw new Error('bencode: truncated int')
        pos = end + 1
        return
      }
      if (c === 0x6c || c === 0x64) {
        pos++
        for (;;) {
          if (pos >= data.length) throw new Error('bencode: truncated container')
          if (data[pos] === 0x65) {
            pos++
            return
          }
          if (c === 0x64) {
            // key
            skipStr()
          }
          skip()
        }
      }
      skipStr()
    }
    const skipStr = (): void => {
      let len = 0
      while (pos < data.length && data[pos] !== 0x3a) {
        const c = data[pos]
        if (c < 0x30 || c > 0x39) throw new Error('bencode: bad length in info')
        len = len * 10 + (c - 0x30)
        pos++
      }
      pos++
      if (pos + len > data.length) throw new Error('bencode: info string overruns')
      pos += len
    }
    skip()
    return data.subarray(start, pos)
  }
  throw new Error('bencode: info key not found')
}
