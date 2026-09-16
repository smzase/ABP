/**
 * 纯逻辑单测：模板引擎 / 字幕识别 / 文件名解析 / bencode（含畸形输入）/ 存储文档。
 * 直接 import TS 源码跑（node ≥ 22.18 内置 type-stripping），不进 Electron、不编译，CI 友好。
 * 运行：node scripts/run-checks.mjs
 */
import assert from 'node:assert/strict'
import {
  renderTemplate,
  padEpisode,
  versionSuffix,
  languageCodeTag,
  subtitleLangZhTag,
  pickTitleVariant
} from '../src/shared/template.ts'
import { sortLanguages } from '../src/shared/constants.ts'
import { detectSubtitle, DEFAULT_SUBTITLE_RULES } from '../src/shared/subtitle-detect.ts'
import { parseFileName } from '../src/shared/parse-name.ts'
import {
  applyFilenameExample,
  exampleKindForProfile,
  inferSubtitleType,
  learnFilenameExample
} from '../src/shared/torrent-profile.ts'
import { matchAnimeTemplateId } from '../src/shared/anime-match.ts'
import {
  bdecode,
  normalizeTorrentTrackers,
  parseTorrent,
  TORRENT_TRACKER_LIMIT
} from '../src/shared/bencode.ts'
import { defaultAppData, sanitizeAppData } from '../src/shared/store-doc.ts'
import { sealSecrets, openSecrets, collectSecrets } from '../src/shared/secrets-crypto.ts'
import { toPlain } from '../src/shared/plain.ts'
import { validatePublishPayload } from '../src/shared/publish-validate.ts'
import { parsePublishResponse } from '../src/shared/publish-response.ts'
import { addTorrent, getTorrent, removeTorrent } from '../src/main/torrents.ts'
// 这里确实要真的 Vue：toPlain 防的就是 Vue 的响应式 Proxy 撞上结构化克隆，
// 拿普通对象冒充测不出任何东西（vue 本来就在 devDependencies 里）。
import { reactive, ref } from 'vue'

let passed = 0
function ok(name, fn) {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

console.log('template:')
ok('ep 补零', () => {
  assert.equal(padEpisode('1'), '01')
  assert.equal(padEpisode('08'), '08')
  assert.equal(padEpisode('12'), '12')
  assert.equal(padEpisode('12.5'), '12.5')
})
ok('versionSuffix：v1 不显示，v2+ 显示 [v2]', () => {
  assert.equal(versionSuffix('v1'), '')
  assert.equal(versionSuffix(''), '')
  assert.equal(versionSuffix(undefined), '')
  assert.equal(versionSuffix('v2'), '[v2]')
  assert.equal(versionSuffix('v10'), '[v10]')
})
ok('languageCode / subtitleLangZh', () => {
  assert.equal(languageCodeTag(['CHS', 'JP']), 'CHS&JP')
  assert.equal(languageCodeTag(['CHS', 'CHT', 'JP']), 'CHS&CHT&JP')
  assert.equal(subtitleLangZhTag(['CHS', 'CHT', 'JP'], 'EMBEDDED'), '简繁日内封')
  assert.equal(subtitleLangZhTag(['CHS'], 'INTERNAL'), '简内嵌')
  assert.equal(subtitleLangZhTag([], 'NONE'), '无字幕')
})
ok('语言顺序固定为 CHS/CHT/JP/EN，不会出现 JP&CHS', () => {
  assert.equal(languageCodeTag(['JP', 'CHS']), 'CHS&JP')
  assert.equal(languageCodeTag(['JP', 'CHT', 'CHS']), 'CHS&CHT&JP')
  assert.equal(languageCodeTag(['EN', 'JP', 'CHS']), 'CHS&JP&EN')
  assert.equal(subtitleLangZhTag(['JP', 'CHS', 'CHT'], 'EMBEDDED'), '简繁日内封')
  // 自定义代码排在预设之后，彼此保持原有相对顺序
  assert.equal(languageCodeTag(['KR', 'JP', 'CHS', 'FR']), 'CHS&JP&KR&FR')
  assert.deepEqual(sortLanguages(['JP', 'CHS']), ['CHS', 'JP'])
})
ok('titleZhHans / titleZhHant：简繁两个变量', () => {
  const ctx = { titleZh: '简体名', titleZhHans: '简体名', titleZhHant: '繁體名' }
  assert.equal(renderTemplate('{{titleZhHans}}', ctx), '简体名')
  assert.equal(renderTemplate('{{titleZhHant}}', ctx), '繁體名')
  // 繁体名没填 → 回落简体，不能渲染成空
  assert.equal(renderTemplate('{{titleZhHant}}', { titleZhHans: '简体名' }), '简体名')
  assert.equal(renderTemplate('{{titleZhHant}}', { titleZhHans: '简体名', titleZhHant: '  ' }), '简体名')
  // 繁体标题变体下 titleZh 是繁体名，但 titleZhHans 仍然必须是简体
  const trad = { titleZh: '繁體名', titleZhHans: '简体名', titleZhHant: '繁體名' }
  assert.equal(renderTemplate('{{titleZh}}|{{titleZhHans}}', trad), '繁體名|简体名')
})
ok('变量名大小写不敏感', () => {
  const ctx = { titleZhHans: '简体名', titleZhHant: '繁體名' }
  assert.equal(renderTemplate('{{titlezhHans}}', ctx), '简体名')
  assert.equal(renderTemplate('{{titlezhhant}}', ctx), '繁體名')
  assert.equal(renderTemplate('{{TITLEZHHANS}}', ctx), '简体名')
  // 仍然只认真实存在的变量，别的原样留着
  assert.equal(renderTemplate('{{nosuchvar}}', ctx), '{{nosuchvar}}')
})
ok('完整渲染（需求示例）', () => {
  const out = renderTemplate(
    '[{{groupName}}] {{titleZh}} / {{titleRomaji}} / {{titleNative}} - {{ep}} - [{{subtitleLangZh}}][{{codecBitDepth}} {{resolutionUpper}} {{audioCodec}}]{{versionSuffix}}',
    {
      groupName: '三明治摆烂组',
      titleZh: '少女怪兽焦糖味',
      titleRomaji: 'Otome Kaijuu Carameliser',
      titleNative: '乙女怪獣キャラメリゼ',
      ep: '8',
      version: 'v1',
      resolution: '1080p',
      codec: 'HEVC',
      bitDepth: '10bit',
      audioCodec: 'AAC',
      languages: ['CHS', 'CHT', 'JP'],
      subtitleType: 'EMBEDDED'
    }
  )
  assert.equal(out, '[三明治摆烂组] 少女怪兽焦糖味 / Otome Kaijuu Carameliser / 乙女怪獣キャラメリゼ - 08 - [简繁日内封][HEVC-10bit 1080P AAC]')
})
ok('未知变量保留原样，customTags 空格拼接', () => {
  const out = renderTemplate('{{unknown}} {{customTags}}', { customTags: ['NF', 'VOSTFR', 'ADN'] })
  assert.equal(out, '{{unknown}} NF VOSTFR ADN')
})
ok('pickTitleVariant', () => {
  assert.equal(pickTitleVariant(['CHS']), 'simp')
  assert.equal(pickTitleVariant(['CHT']), 'trad')
  assert.equal(pickTitleVariant(['CHS', 'CHT']), 'both')
  assert.equal(pickTitleVariant(['CHT', 'JP']), 'trad')
})
ok('标题繁化：繁体标签使用传统字形', () => {
  assert.equal(subtitleLangZhTag(['CHS', 'CHT', 'JP'], 'EMBEDDED', true), '簡繁日內封')
  assert.equal(
    renderTemplate('{{titleZh}} [{{subtitleLangZh}}]', {
      titleZh: '繁體名',
      languages: ['CHS', 'CHT', 'JP'],
      subtitleType: 'EMBEDDED',
      traditionalizeTitle: true
    }),
    '繁體名 [簡繁日內封]'
  )
  assert.equal(subtitleLangZhTag(['CHS'], 'INTERNAL'), '简内嵌')
})
ok('种子标题自动匹配番剧模板，长名称优先', () => {
  const templates = [
    { id: 'short', names: { zh: '芙莉莲', zhTw: '', romaji: '', en: '', native: '' } },
    { id: 'long', names: { zh: '葬送的芙莉莲', zhTw: '', romaji: 'Sousou no Frieren', en: '', native: '葬送のフリーレン' } }
  ]
  assert.equal(matchAnimeTemplateId('[Group] 葬送的芙莉莲 - 01.torrent', '葬送のフリーレン - 01', templates), 'long')
  assert.equal(matchAnimeTemplateId('[Group] Unknown Show - 01.torrent', 'Unknown Show - 01', templates), '')
})
console.log('subtitle-detect:')
ok('预设词识别', () => {
  const r = detectSubtitle('[Group] Title - 01 [CHS_JP][简繁日内封][1080p]', DEFAULT_SUBTITLE_RULES)
  assert.ok(r.languages.includes('CHS') && r.languages.includes('CHT') && r.languages.includes('JP'))
  assert.equal(r.subtitleType, 'EMBEDDED')
})
ok('长词优先：CHS_JP 不被 CHS 抢先', () => {
  const r = detectSubtitle('abc CHS_JP abc', DEFAULT_SUBTITLE_RULES)
  assert.ok(r.hits.includes('CHS_JP'))
  assert.ok(r.languages.includes('JP'))
})
ok('短词边界：DSC / SCREEN 里的 SC 不算简体', () => {
  const r = detectSubtitle('Movie SCREENSHOTS', DEFAULT_SUBTITLE_RULES)
  assert.ok(!r.languages.includes('CHS'))
})
ok('繁体内嵌', () => {
  const r = detectSubtitle('标题 繁體內嵌', DEFAULT_SUBTITLE_RULES)
  assert.equal(r.subtitleType, 'INTERNAL')
  assert.ok(r.languages.includes('CHT'))
})
ok('CHI 系 = 中文不分简繁 → CHS+CHT（用户实例）', () => {
  // [CHI_JPN] 曾经只认出 CHS+JP，漏掉繁体
  const r = detectSubtitle(
    '[smzase] Rakudai Kenja no Gakuin Musou - S01E08 - [CHI_JPN][WebRip H265 10bit 1080P].mkv',
    DEFAULT_SUBTITLE_RULES
  )
  assert.deepEqual(r.languages, ['CHS', 'CHT', 'JP'])
  assert.equal(languageCodeTag(r.languages), 'CHS&CHT&JP')
  assert.deepEqual(detectSubtitle('x [CHI] x', DEFAULT_SUBTITLE_RULES).languages, ['CHS', 'CHT'])
  assert.deepEqual(detectSubtitle('x [CHI_JP] x', DEFAULT_SUBTITLE_RULES).languages, ['CHS', 'CHT', 'JP'])
})
ok('识别结果顺序固定 CHS/CHT/JP/EN', () => {
  // JPN 比 CHS 长，先命中；不排序的话会得到 JP&CHS
  const r = detectSubtitle('Title [JPN][CHS]', DEFAULT_SUBTITLE_RULES)
  assert.deepEqual(r.languages, ['CHS', 'JP'])
  assert.deepEqual(detectSubtitle('Title [ENG][JPN][CHT]', DEFAULT_SUBTITLE_RULES).languages, ['CHT', 'JP', 'EN'])
})
ok('简日 / 繁日 及其内封内嵌外挂', () => {
  assert.deepEqual(detectSubtitle('标题 [简日双语]', DEFAULT_SUBTITLE_RULES).languages, ['CHS', 'JP'])
  assert.deepEqual(detectSubtitle('标题 [繁日]', DEFAULT_SUBTITLE_RULES).languages, ['CHT', 'JP'])
  const a = detectSubtitle('标题 [简日内嵌]', DEFAULT_SUBTITLE_RULES)
  assert.deepEqual(a.languages, ['CHS', 'JP'])
  assert.equal(a.subtitleType, 'INTERNAL')
  const b = detectSubtitle('标题 [繁日內封]', DEFAULT_SUBTITLE_RULES)
  assert.deepEqual(b.languages, ['CHT', 'JP'])
  assert.equal(b.subtitleType, 'EMBEDDED')
  const c = detectSubtitle('标题 [简繁日外挂]', DEFAULT_SUBTITLE_RULES)
  assert.deepEqual(c.languages, ['CHS', 'CHT', 'JP'])
  assert.equal(c.subtitleType, 'EXTERNAL')
})
ok('Nyaa 紧凑语言代码', () => {
  assert.deepEqual(detectSubtitle('[Nekomoe kissaten][Kimi ga Shinu made Koi wo Shitai][11][1080p][JPSC].mp4', DEFAULT_SUBTITLE_RULES).languages, ['CHS', 'JP'])
  assert.deepEqual(detectSubtitle('[Nekomoe kissaten][Ikoku Nikki][01-13][1080p][JPTC]', DEFAULT_SUBTITLE_RULES).languages, ['CHT', 'JP'])
})

ok('番剧名里的常见汉字不该被当成语言', () => {
  // 「日」「英」单字不进词库：夏日/日常/英雄 这类名字太多了
  for (const name of ['[组] 夏日重现 - 01 [1080p].mkv', '[组] 日常 - 05 [1080p].mkv', '[组] 我的英雄学院 - 03.mkv']) {
    assert.deepEqual(detectSubtitle(name, DEFAULT_SUBTITLE_RULES).languages, [], name)
  }
})

console.log('parse-name:')
ok('综合解析', () => {
  const p = parseFileName('[三明治摆烂组] 少女怪兽焦糖味 - 08 [简繁日内封][HEVC-10bit 1080P AAC][WEB-DL].mkv')
  assert.equal(p.episode, '08')
  assert.equal(p.resolution, '1080p')
  assert.equal(p.codec, 'HEVC')
  assert.equal(p.bitDepth, '10bit')
  assert.equal(p.audioCodec, 'AAC')
  assert.equal(p.source, 'WEB-DL')
  assert.equal(p.format, 'MKV')
})
ok('版本识别', () => {
  assert.equal(parseFileName('Title - 01v2 [1080p].mkv').version, 'v2')
  assert.equal(parseFileName('Title - 01 [1080p].mkv').version, null)
})
ok('范围集数与版本边界', () => {
  assert.equal(parseFileName('[三明治摆烂组] Summer Pockets [01-14][简日内嵌][BDRip H264 8bit 1080P]').episode, '01-14')
  assert.equal(parseFileName('[Nekomoe kissaten&LoliHouse] Ikoku Nikki [01-13][WebRip 1080p HEVC-10bit AAC ASSx2]').episode, '01-13')
  assert.equal(parseFileName('[三明治摆烂组] Summer Pockets [01-26 合集][简繁日内封][H265 10bit 1080P]').episode, '01-26')
  assert.equal(parseFileName('[smzase] LV999 no Murabito - S01E01 - [CHS_JPN][WebRip H264 8bit 1080P].mp4').version, null)
  assert.equal(parseFileName('[smzase] LV999 no Murabito - S01E12 - [CHS_JPN][WebRip H264 8bit 1080P][V2].mp4').version, 'v2')
  assert.equal(parseFileName('Title - 01v2 [1080p].mkv').episode, '01')
  assert.equal(parseFileName('Title - 01v2 [1080p].mkv').version, 'v2')
  assert.equal(parseFileName('AV1 encode - 01 [1080p].mkv').version, null)
  assert.equal(parseFileName('Title - 01 [1080p] V2.mkv').version, 'v2')
  assert.equal(parseFileName('Show V2 - 01 [1080p].mkv').version, null)
})

ok('SxxExx 集数（曾经整个漏掉 → episodeKey 发出去是空串）', () => {
  // 用户实例：S01E08 前面几条规则都要求数字前是空格/横杠/括号，字母 E 一条都不匹配
  assert.equal(
    parseFileName('[smzase] Rakudai Kenja no Gakuin Musou - S01E08 - [CHI_JPN][WebRip H265 10bit 1080P].mkv').episode,
    '08'
  )
  assert.equal(parseFileName('[Group] Show S02E05 [1080p].mkv').episode, '05')
  assert.equal(parseFileName('[Group] Show s1e8 [1080p].mkv').episode, '8')
  assert.equal(parseFileName('[Group] Show S01.E12 [1080p].mkv').episode, '12')
  // 季号不能被当成集数
  assert.notEqual(parseFileName('[Group] Show S02E05 [1080p].mkv').episode, '02')
  // 老写法不受影响
  assert.equal(parseFileName('[Group] Title - 08 [1080p].mkv').episode, '08')
  assert.equal(parseFileName('[Group] Movie [1080p].mkv').episode, null)
})

console.log('torrent-profile:')
ok('字幕类型按显式词库优先、容器规则兜底', () => {
  const mp4 = parseFileName('[Group] Show - 01 [CHS_JP][1080p].mp4')
  const mkv = parseFileName('[Group] Show - 01 [CHS_CHT_JP][1080p].mkv')
  const raw = parseFileName('[Group] Show - 01 [1080p].mp4')
  assert.equal(inferSubtitleType(mp4.format, mp4.languages, mp4.subtitleType), 'INTERNAL')
  assert.equal(inferSubtitleType(mkv.format, mkv.languages, mkv.subtitleType), 'EMBEDDED')
  assert.equal(inferSubtitleType(raw.format, raw.languages, raw.subtitleType), 'NONE')
  assert.equal(inferSubtitleType('MP4', ['CHS'], 'EMBEDDED'), 'EMBEDDED')
  assert.equal(inferSubtitleType('MKV', ['CHS'], 'INTERNAL'), 'INTERNAL')
})
ok('模板文件名示例覆盖发布字段但保留当前集数', () => {
  const current = parseFileName('[Group] Show - 08 [CHS_JP][720p].mp4')
  const sample = '[Group] Show - 01 [简日内嵌][HEVC-10bit 1080P AAC][WEB-DL].mp4'
  const out = applyFilenameExample(current, { simpInternal: sample, tradInternal: '', embedded: '' })
  assert.equal(out.episode, '08')
  assert.equal(out.resolution, '1080p')
  assert.equal(out.format, 'MP4')
  assert.equal(out.subtitleType, 'INTERNAL')
  assert.deepEqual(out.languages, ['CHS', 'JP'])
  assert.equal(out.codec, 'HEVC')
  assert.equal(out.bitDepth, '10bit')
  assert.equal(out.audioCodec, 'AAC')
  assert.equal(out.source, 'WEB-DL')
  assert.equal(exampleKindForProfile(current), 'simpInternal')
  const overridden = applyFilenameExample(current, { simpInternal: { fileName: sample, languages: ['CHT'], subtitleType: 'INTERNAL', resolution: '1080p', format: 'MP4', codec: 'HEVC', bitDepth: '10bit', audioCodec: 'AAC', source: 'WEB-DL', version: '' }, tradInternal: { fileName: '', languages: [], subtitleType: null, resolution: '', format: '', codec: '', bitDepth: '', audioCodec: '', source: '', version: '' }, embedded: { fileName: '', languages: [], subtitleType: null, resolution: '', format: '', codec: '', bitDepth: '', audioCodec: '', source: '', version: '' } })
  assert.deepEqual(overridden.languages, ['CHT'])
  assert.equal(overridden.resolution, '1080p')
})
ok('自动学习只填空示例槽位', () => {
  const initial = { simpInternal: '', tradInternal: 'manual-trad.mp4', embedded: '' }
  const learned = learnFilenameExample(initial, 'simpInternal', '[Group] Show - 01 [CHS_JP].mp4')
  assert.equal(learned.simpInternal.fileName, '[Group] Show - 01 [CHS_JP].mp4')
  assert.equal(learned.tradInternal, 'manual-trad.mp4')
  assert.equal(learnFilenameExample(learned, 'simpInternal', 'other.mp4'), learned)
})
console.log('publish-validate:')
ok('空标题被拦下（站点只会回一句 Invalid request body）', () => {
  const base = { title: 'T', resolution: '1080p', format: 'MKV', subtitle: 'EMBEDDED', language: ['CHS'] }
  assert.deepEqual(validatePublishPayload(base), [])
  assert.equal(validatePublishPayload({ ...base, title: '' })[0].key, 'publishCheck.titleRequired')
  assert.equal(validatePublishPayload({ ...base, title: '   ' })[0].key, 'publishCheck.titleRequired')
})
ok('枚举外的值被拦下，并带上具体是哪个值', () => {
  const base = { title: 'T', resolution: '1080p', format: 'MKV', subtitle: 'EMBEDDED', language: ['CHS'] }
  // 下拉里的「自定义」能打进这些站点不认的值
  const r = validatePublishPayload({ ...base, resolution: '1440p' })
  assert.equal(r[0].key, 'publishCheck.badResolution')
  assert.equal(r[0].params.value, '1440p')
  assert.equal(validatePublishPayload({ ...base, format: 'MOV' })[0].key, 'publishCheck.badFormat')
  assert.equal(validatePublishPayload({ ...base, subtitle: 'HARDSUB' })[0].key, 'publishCheck.badSubtitle')
  const l = validatePublishPayload({ ...base, language: ['CHS', 'KLINGON'] })
  assert.equal(l[0].key, 'publishCheck.badLanguage')
  assert.equal(l[0].params.value, 'KLINGON')
  // 站点认的都要放行：AVI / WEBM / 4K / 21 种语言
  assert.deepEqual(validatePublishPayload({ ...base, format: 'WEBM' }), [])
  assert.deepEqual(validatePublishPayload({ ...base, format: 'AVI' }), [])
  assert.deepEqual(validatePublishPayload({ ...base, resolution: '4K' }), [])
  assert.deepEqual(validatePublishPayload({ ...base, language: ['CHS', 'CHT', 'JP', 'EN', 'KO', 'UK'] }), [])
})
ok('空的可选字段不算错（站点自己有默认值）', () => {
  assert.deepEqual(validatePublishPayload({ title: 'T', resolution: '', format: '', subtitle: '', language: [] }), [])
})
ok('Nyaa 代发必须带分类；notes 有上限', () => {
  const base = { title: 'T', resolution: '1080p', format: 'MKV', subtitle: 'EMBEDDED', language: ['CHS'] }
  assert.equal(
    validatePublishPayload({ ...base, nyaa: true, nyaaCategory: '' })[0].key,
    'publishCheck.nyaaCategoryRequired'
  )
  assert.deepEqual(validatePublishPayload({ ...base, nyaa: true, nyaaCategory: '1_3' }), [])
  assert.deepEqual(validatePublishPayload({ ...base, nyaa: false, nyaaCategory: '' }), [])
  assert.equal(validatePublishPayload({ ...base, notes: 'x'.repeat(50001) })[0].key, 'publishCheck.notesTooLong')
  assert.deepEqual(validatePublishPayload({ ...base, notes: 'x'.repeat(50000) }), [])
})

console.log('publish-response:')
ok('正式发布响应读取 result.releaseId', () => {
  assert.deepEqual(
    parsePublishResponse({ ok: true, result: { releaseId: 'rel_123', matchStatus: 'matched', fileSize: 42 } }, 200),
    { ok: true, releaseId: 'rel_123', matchStatus: 'matched', fileSize: 42 }
  )
})
ok('Preview 响应读取顶层 previewUrl，不访问 result', () => {
  assert.deepEqual(
    parsePublishResponse(
      { ok: true, preview: true, previewUrl: 'https://anibt.net/release/preview/token', previewToken: 'token' },
      200
    ),
    { ok: true, previewUrl: 'https://anibt.net/release/preview/token' }
  )
})
ok('成功响应缺少正式或 Preview 字段时返回可见错误', () => {
  const result = parsePublishResponse({ ok: true }, 200)
  assert.equal(result.ok, false)
  assert.equal(result.error?.httpStatus, 200)
  assert.match(result.error?.message ?? '', /无法识别/)
})

console.log('bencode:')
const te = new TextEncoder()
function makeTorrent({ name = 'test.mkv', announce = 'http://nyaa.tracker.wf:7777/announce', length = 1024 } = {}) {
  return te.encode(`d8:announce${announce.length}:${announce}4:infod6:lengthi${length}e4:name${name.length}:${name}ee`)
}
function makeMultiTrackerTorrent(trackers) {
  const str = (value) => `${te.encode(value).length}:${value}`
  const tiers = trackers.map((tracker) => `l${str(tracker)}e`).join('')
  return te.encode(
    `d8:announce${str(trackers[0])}13:announce-listl${tiers}e4:infod6:lengthi1e4:name1:xee`
  )
}
ok('正常种子解析', () => {
  const info = parseTorrent(makeTorrent())
  assert.equal(info.innerName, 'test.mkv')
  assert.equal(info.totalSize, 1024)
  assert.equal(info.hasNyaaTracker, true)
  assert.ok(info.infoRaw.length > 0)
})
ok('announce-list 多 tracker', () => {
  const t = te.encode('d8:announce1:a13:announce-listll1:bel1:cee4:infod6:lengthi1e4:name1:xee')
  const info = parseTorrent(t)
  assert.ok(info.trackers.includes('b') && info.trackers.includes('c'))
  assert.equal(info.hasNyaaTracker, false)
})
ok('tracker 不超过 50 条时保持原始种子字节', () => {
  const trackers = Array.from({ length: TORRENT_TRACKER_LIMIT }, (_, i) => `udp://tracker${i}.example/announce`)
  const torrent = makeMultiTrackerTorrent(trackers)
  assert.equal(normalizeTorrentTrackers(torrent), torrent)
})
ok('tracker 超过 50 条时规范化上传副本且 info hash 输入不变', () => {
  const trackers = Array.from(
    { length: TORRENT_TRACKER_LIMIT + 1 },
    (_, i) => `udp://tracker${i}.example/announce`
  )
  const torrent = makeMultiTrackerTorrent(trackers)
  const before = parseTorrent(torrent)
  const normalized = normalizeTorrentTrackers(torrent)
  const after = parseTorrent(normalized)
  assert.notEqual(normalized, torrent)
  assert.equal(after.trackers.length, TORRENT_TRACKER_LIMIT)
  assert.deepEqual(after.infoRaw, before.infoRaw)
})
ok('截断 tracker 时优先保留 AniBT 与 Nyaa', () => {
  const trackers = [
    ...Array.from({ length: TORRENT_TRACKER_LIMIT + 1 }, (_, i) => `udp://tracker${i}.example/announce`),
    'https://tracker.anibt.net/announce',
    'http://nyaa.tracker.wf:7777/announce'
  ]
  const info = parseTorrent(normalizeTorrentTrackers(makeMultiTrackerTorrent(trackers)))
  assert.equal(info.trackers.length, TORRENT_TRACKER_LIMIT)
  assert.ok(info.trackers.includes('https://tracker.anibt.net/announce'))
  assert.ok(info.trackers.includes('http://nyaa.tracker.wf:7777/announce'))
  assert.equal(info.hasNyaaTracker, true)
})
ok('种子内存池保存的是 tracker 已规范化的上传副本', () => {
  const trackers = Array.from(
    { length: TORRENT_TRACKER_LIMIT + 1 },
    (_, i) => `udp://tracker${i}.example/announce`
  )
  const meta = addTorrent('many-trackers.torrent', makeMultiTrackerTorrent(trackers))
  const pooled = getTorrent(meta.token)
  assert.ok(pooled)
  assert.equal(meta.trackers.length, TORRENT_TRACKER_LIMIT)
  assert.equal(parseTorrent(pooled.bytes).trackers.length, TORRENT_TRACKER_LIMIT)
  removeTorrent(meta.token)
})
ok('tracker 规范化仍拒绝畸形输入', () => {
  assert.throws(() => normalizeTorrentTrackers(te.encode('d8:announce999999:xe')), /bencode/)
  assert.throws(() => normalizeTorrentTrackers(te.encode('d8:announce1:a13:announce-listl')), /bencode/)
})
ok('畸形输入：声明超长字符串', () => {
  assert.throws(() => bdecode(te.encode('999999:x')), /bencode/)
})
ok('畸形输入：截断', () => {
  assert.throws(() => bdecode(te.encode('d3:foo')), /bencode/)
  assert.throws(() => bdecode(te.encode('i12')), /bencode/)
  assert.throws(() => bdecode(te.encode('5:ab')), /bencode/)
})
ok('畸形输入：纯垃圾字节', () => {
  assert.throws(() => bdecode(te.encode('\x00\xff\nxyz')), /bencode/)
  assert.throws(() => bdecode(new Uint8Array(0)), /bencode/)
})
ok('畸形输入：缺 info 的种子', () => {
  assert.throws(() => parseTorrent(te.encode('d8:announce1:aee')), /info/)
})

console.log('store-doc:')
ok('默认值完整', () => {
  const d = defaultAppData()
  assert.equal(d.version, 1)
  assert.equal(d.settings.proxy.host, '127.0.0.1')
  assert.equal(d.settings.proxy.port, 7890)
  assert.ok(d.settings.subtitleDetect.rules.length > 0)
  assert.ok(d.titleTemplates.length > 0)
})
ok('损坏输入回退默认', () => {
  assert.deepEqual(sanitizeAppData(null), defaultAppData())
  assert.deepEqual(sanitizeAppData('garbage'), defaultAppData())
  assert.deepEqual(sanitizeAppData(42), defaultAppData())
})
ok('部分字段合并：保留好的、补全缺的', () => {
  const out = sanitizeAppData({
    settings: { appearance: { mode: 'light', accent: '#00b3f2' }, proxy: { mode: 'custom', port: 1080 } },
    groups: [{ id: 'g1', name: '组A', apiKey: 'k' }],
    records: [{ id: 'r1', title: 'T', subtitle: 'EMBEDDED', publishedAt: 1 }]
  })
  assert.equal(out.settings.appearance.mode, 'light')
  assert.equal(out.settings.appearance.accent, '#00b3f2')
  assert.equal(out.settings.proxy.mode, 'custom')
  assert.equal(out.settings.proxy.port, 1080)
  assert.equal(out.settings.proxy.host, '127.0.0.1')
  assert.equal(out.groups.length, 1)
  assert.equal(out.groups[0].name, '组A')
  assert.equal(out.records[0].subtitle, 'EMBEDDED')
  assert.equal(out.records[0].version, 'v1')
})
ok('深拷贝隔离：改返回值不影响预设词库', () => {
  const a = defaultAppData()
  a.settings.subtitleDetect.rules.push({ word: 'X', langs: [], type: null })
  const b = defaultAppData()
  assert.ok(!b.settings.subtitleDetect.rules.some((r) => r.word === 'X'))
})
ok('外观默认浅色，只有显式 dark 才转深色', () => {
  assert.equal(defaultAppData().settings.appearance.mode, 'light')
  assert.equal(sanitizeAppData({}).settings.appearance.mode, 'light')
  assert.equal(sanitizeAppData({ settings: { appearance: {} } }).settings.appearance.mode, 'light')
  assert.equal(sanitizeAppData({ settings: { appearance: { mode: 'nonsense' } } }).settings.appearance.mode, 'light')
  assert.equal(sanitizeAppData({ settings: { appearance: { mode: 'dark' } } }).settings.appearance.mode, 'dark')
})
ok('番剧模板的标题模板/简介留空就是留空，不回填全局模板', () => {
  const out = sanitizeAppData({
    titleTemplates: [{ id: 't1', name: '全局', template: '[{{groupName}}] {{titleZh}}' }],
    descTemplates: [{ id: 'd1', name: '全局简介', markdown: '# hi' }],
    animeTemplates: [{ id: 'a1', bgmId: 1, titleTemplates: { simp: '', trad: '', both: '' }, descriptionMd: '' }]
  })
  const a = out.animeTemplates[0]
  assert.equal(a.titleTemplates.simp, '')
  assert.equal(a.titleTemplates.trad, '')
  assert.equal(a.titleTemplates.both, '')
  assert.equal(a.descriptionMd, '')
  assert.deepEqual(a.filenameExamples.simpInternal, { fileName: '', languages: [], subtitleType: null, resolution: '', format: '', codec: '', bitDepth: '', audioCodec: '', source: '' })
  // 整个字段缺失时同样留空（不拿第一条全局模板顶上）
  const missing = sanitizeAppData({
    titleTemplates: [{ id: 't1', name: '全局', template: 'X' }],
    animeTemplates: [{ id: 'a2', bgmId: 2 }]
  })
  assert.equal(missing.animeTemplates[0].titleTemplates.simp, '')
})

console.log('plain (IPC 序列化):')
ok('响应式对象直接进 IPC 会被结构化克隆拒绝，toPlain 解掉', () => {
  // 这条用真正的 Vue reactive 复现线上那个「An object could not be cloned.」：
  // reactive/ref 返回的是 Proxy，结构化克隆（contextBridge / ipcRenderer）不认。
  // 发布 payload 里只要有一个字段是从 store 直接取的数组就整个炸，且报错不说是哪个字段。
  const entry = reactive({ id: 'e1', languages: ['CHS', 'CHT', 'JP'], customTags: ['NF'] })
  assert.throws(() => structuredClone({ language: entry.languages }), /could not be cloned/)
  // 过一遍 toPlain 就能克隆，且内容不变
  const payload = toPlain({ title: 'T', language: entry.languages, tags: entry.customTags })
  assert.deepEqual(structuredClone(payload), { title: 'T', language: ['CHS', 'CHT', 'JP'], tags: ['NF'] })
  // ref 包出来的数组同理
  const langs = ref(['CHS'])
  assert.throws(() => structuredClone({ language: langs.value }), /could not be cloned/)
  assert.deepEqual(toPlain({ language: langs.value }), { language: ['CHS'] })
})
ok('toPlain 是深拷贝，改副本不影响原对象', () => {
  const src = reactive({ nested: { list: [1, 2] } })
  const copy = toPlain(src)
  copy.nested.list.push(3)
  assert.deepEqual(src.nested.list, [1, 2])
})

console.log('secrets-crypto:')
ok('往返：封好再解开还是原样', () => {
  const map = { g1: 'abp_live_key_1', g2: '第二组的 key' }
  assert.deepEqual(openSecrets(sealSecrets(map)), map)
})
ok('每次封装 iv 不同（同明文密文不重复）', () => {
  const a = sealSecrets({ g1: 'k' })
  const b = sealSecrets({ g1: 'k' })
  assert.notEqual(a.iv, b.iv)
  assert.notEqual(a.data, b.data)
})
ok('畸形输入一律回退空表，不抛', () => {
  for (const bad of [null, undefined, 42, 'garbage', [], {}, { alg: 'aes-256-gcm' }]) {
    assert.deepEqual(openSecrets(bad), {})
  }
})
ok('篡改检测：改 data / tag / alg 都解不开', () => {
  const env = sealSecrets({ g1: 'secret' })
  assert.deepEqual(openSecrets({ ...env, data: Buffer.from('tampered').toString('base64') }), {})
  assert.deepEqual(openSecrets({ ...env, tag: Buffer.alloc(16).toString('base64') }), {})
  assert.deepEqual(openSecrets({ ...env, alg: 'aes-128-gcm' }), {})
})
ok('非字符串 / 空串的 key 被丢掉', () => {
  const env = sealSecrets({ g1: 'ok', g2: '', g3: 123 })
  assert.deepEqual(openSecrets(env), { g1: 'ok' })
})
ok('collectSecrets 只抽非空 apiKey', () => {
  assert.deepEqual(
    collectSecrets([
      { id: 'a', apiKey: 'ka' },
      { id: 'b', apiKey: '' },
      { id: 'c', apiKey: 'kc' }
    ]),
    { a: 'ka', c: 'kc' }
  )
})

console.log(`\n全部通过：${passed} 项`)
