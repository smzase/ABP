/**
 * 纯逻辑单测：模板引擎 / 字幕识别 / 文件名解析 / bencode（含畸形输入）/ 存储文档。
 * 直接 import TS 源码跑（node ≥ 22.18 内置 type-stripping），不进 Electron、不编译，CI 友好。
 * 运行：node scripts/run-checks.mjs
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DataDirectory } from '../src/main/data-directory.ts'
import { fontStack, DEFAULT_FONT_STACK } from '../src/shared/font.ts'
import {
  renderTemplate,
  padEpisode,
  versionSuffix,
  languageCodeTag,
  subtitleLangZhTag,
  pickTitleVariant
} from '../src/shared/template.ts'
import { sortLanguages } from '../src/shared/constants.ts'
import {
  detectSubtitle,
  DEFAULT_SUBTITLE_RULES,
  SUBTITLE_PRESET_VERSION,
  updateSubtitlePresets
} from '../src/shared/subtitle-detect.ts'
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
import { sealSecrets, openSecrets, collectSecrets, mergeSecrets, redactSecrets } from '../src/shared/secrets-crypto.ts'
import { formatDescription, markdownToBbcode, markdownToHtml } from '../src/shared/description-format.ts'
import {
  buildMikanRequestBody,
  mikanEpisodeUrl,
  parseMikanSearchItems,
  selectMikanBangumiMatch
} from '../src/shared/mikan.ts'
import { dmhyCookieHeader, extractDmhyTopicLink, parseDmhyIdentities, selectDmhyIdentity } from '../src/shared/dmhy.ts'
import { loadDmhyPublishContext } from '../src/main/dmhy.ts'
import { PUBLISH_SITES } from '../src/shared/types.ts'
import { isAnibtWebUrl, hasAnibtWebSession } from '../src/shared/anibt-web.ts'
import {
  defaultSiteAccount,
  acgripPostAsTeamValue,
  evaluateDmhyLoginResponse,
  isSiteConfigured,
  normalizeAcgripToken,
  siteConfigurationError,
  SITE_URLS,
  unavailableCredentialCheck
} from '../src/shared/sites.ts'
import { toPlain } from '../src/shared/plain.ts'
import { validatePublishPayload } from '../src/shared/publish-validate.ts'
import { parsePublishResponse } from '../src/shared/publish-response.ts'
import { addTorrent, getTorrent, removeTorrent } from '../src/main/torrents.ts'
import { publishSitesSerially } from '../src/shared/local-publish.ts'
// 这里确实要真的 Vue：toPlain 防的就是 Vue 的响应式 Proxy 撞上结构化克隆，
// 拿普通对象冒充测不出任何东西（vue 本来就在 devDependencies 里）。
import { reactive, ref } from 'vue'

let passed = 0
function ok(name, fn) {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

async function okAsync(name, fn) {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

await okAsync('本地发布隔离单站网络异常并保留其他站点结果', async () => {
  const started = []
  const results = await publishSitesSerially(['anibt', 'mikan', 'acgrip'], async (site) => {
    started.push(site)
    if (site === 'mikan') throw new Error('net::ERR_CONNECTION_CLOSED')
    return { site, ok: true, url: `https://${site}.test/release` }
  })
  assert.deepEqual(started, ['anibt', 'mikan', 'acgrip'])
  assert.deepEqual(results, [
    { site: 'anibt', ok: true, url: 'https://anibt.test/release' },
    { site: 'mikan', ok: false, error: 'Error: net::ERR_CONNECTION_CLOSED' },
    { site: 'acgrip', ok: true, url: 'https://acgrip.test/release' }
  ])
})

console.log('template:')
ok('version 变量默认/v1 留空，v2+ 正常显示，变量名忽略大小写', () => {
  for (const version of [undefined, '', 'v1', ' V1 ']) {
    assert.equal(renderTemplate('E{{ep}}{{version}}', { ep: '8', version }), 'E08')
  }
  assert.equal(renderTemplate('E{{ep}}{{VERSION}}', { ep: '8', version: 'v2' }), 'E08v2')
  assert.equal(renderTemplate('{{version}} {{versionSuffix}}', { version: 'v12' }), 'v12 [v12]')
})
ok('模板标签和字体持久化：兼容缺省字段并保留标签顺序', () => {
  const clean = sanitizeAppData({ animeTemplates: [{ names: { zh: '测试番剧' }, customTags: ['WEB', 'HDR', 'WEB', ''] }], settings: { appearance: { fontFamily: 'Noto Sans CJK SC' } } })
  assert.deepEqual(clean.animeTemplates[0].customTags, ['WEB', 'HDR'])
  assert.equal(clean.settings.appearance.fontFamily, 'Noto Sans CJK SC')
  assert.deepEqual(sanitizeAppData({ animeTemplates: [{}] }).animeTemplates[0].customTags, [])
  assert.equal(sanitizeAppData({}).settings.appearance.fontFamily, '')
  assert.equal(fontStack(''), DEFAULT_FONT_STACK)
  assert.equal(fontStack('Font "Quoted"'), '"Font \\"Quoted\\"", ' + DEFAULT_FONT_STACK)
})
ok('数据目录：迁移验证、原目录保留、重启定位与重复迁移', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'abp-dir-check-'))
  try {
    const source = path.join(root, 'default'), target = path.join(root, 'custom'), second = path.join(root, 'second')
    for (const dir of [source, target, second]) fs.mkdirSync(dir)
    fs.writeFileSync(path.join(source, 'config.json'), '{"version":1}')
    const encrypted = JSON.stringify(sealSecrets({ group: { anibt: { apiKey: 'test-only-key' } } }))
    fs.writeFileSync(path.join(source, 'secrets.json'), encrypted)
    fs.mkdirSync(path.join(source, 'pending-torrents'))
    fs.writeFileSync(path.join(source, 'pending-torrents', 'retry.torrent'), Buffer.from([0, 255, 12]))
    const dirs = new DataDirectory(source)
    assert.equal(dirs.get(), source)
    assert.equal(dirs.change(target), fs.realpathSync(target))
    assert.equal(fs.readFileSync(path.join(target, 'secrets.json'), 'utf8'), encrypted)
    assert.deepEqual(fs.readFileSync(path.join(target, 'pending-torrents', 'retry.torrent')), Buffer.from([0, 255, 12]))
    assert.ok(fs.existsSync(path.join(source, 'config.json')))
    assert.equal(new DataDirectory(source).get(), fs.realpathSync(target))
    assert.equal(dirs.change(target), fs.realpathSync(target))
    assert.equal(dirs.change(second), fs.realpathSync(second))
    assert.equal(new DataDirectory(source).get(), fs.realpathSync(second))
    assert.ok(!fs.existsSync(path.join(second, 'data-location.json')))
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
ok('数据目录：拒绝非空/嵌套路径，不覆盖文件或切换定位', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'abp-dir-invalid-'))
  try {
    const source = path.join(root, 'default'), occupied = path.join(root, 'occupied'), nested = path.join(source, 'nested')
    fs.mkdirSync(nested, { recursive: true }); fs.mkdirSync(occupied)
    fs.writeFileSync(path.join(occupied, 'config.json'), 'keep')
    const dirs = new DataDirectory(source)
    assert.throws(() => dirs.change(occupied), /DATA_DIR_NOT_EMPTY/)
    assert.throws(() => dirs.change(nested), /DATA_DIR_RELATED/)
    assert.throws(() => dirs.change(root), /DATA_DIR_RELATED/)
    assert.throws(() => dirs.change('relative'))
    assert.equal(fs.readFileSync(path.join(occupied, 'config.json'), 'utf8'), 'keep')
    assert.equal(new DataDirectory(source).get(), source)
    fs.writeFileSync(path.join(source, 'data-location.json'), '{broken')
    assert.throws(() => new DataDirectory(source).get())
    fs.writeFileSync(path.join(source, 'data-location.json'), '{"directory":"relative"}')
    assert.throws(() => new DataDirectory(source).get(), /Invalid data directory/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
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
  assert.equal(subtitleLangZhTag(['CHS', 'CHT', 'JP'], 'NONE'), '无字幕')
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
ok('数据目录：复制中途失败仍保留原目录，符号链接不能引出迁移范围', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'abp-dir-failure-'))
  const originalCopy = fs.cpSync
  try {
    const source = path.join(root, 'default'), target = path.join(root, 'target'), linked = path.join(root, 'linked')
    for (const dir of [source, target, linked]) fs.mkdirSync(dir)
    fs.writeFileSync(path.join(source, 'config.json'), '{"version":1}')
    fs.writeFileSync(path.join(source, 'secrets.json'), 'encrypted-fixture')
    const dirs = new DataDirectory(source)
    fs.cpSync = (from, to, options) => {
      if (path.basename(from) === 'secrets.json') throw new Error('Simulated disk failure')
      return originalCopy(from, to, options)
    }
    assert.throws(() => dirs.change(target), /Simulated disk failure/)
    fs.cpSync = originalCopy
    assert.equal(new DataDirectory(source).get(), source)
    assert.equal(fs.readFileSync(path.join(source, 'config.json'), 'utf8'), '{"version":1}')
    assert.equal(fs.readFileSync(path.join(source, 'secrets.json'), 'utf8'), 'encrypted-fixture')
    fs.symlinkSync(linked, path.join(source, 'pending-torrents'), process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => dirs.change(linked), /symbolic link/)
    assert.equal(dirs.get(), source)
  } finally { fs.cpSync = originalCopy; fs.rmSync(root, { recursive: true, force: true }) }
})
ok('无字幕模板忽略残留语言，不能生成“简繁日无字幕”', () => {
  assert.equal(
    renderTemplate('{{languageCode}}|{{subtitleLangZh}}', {
      languages: ['CHS', 'CHT', 'JP'],
      subtitleType: 'NONE'
    }),
    '|无字幕'
  )
})
ok('数字/短标题不会靠集数或组名误选模板', () => {
  const templates = [
    { id: 'number', names: { zh: '86', zhTw: '', romaji: '', en: '86', native: '' } },
    { id: 'full', names: { zh: '86－不存在的战区－', zhTw: '', romaji: '', en: '86 Eighty Six', native: '' } },
    { id: 'up', names: { zh: '', zhTw: '', romaji: '', en: 'Up', native: '' } }
  ]
  assert.equal(matchAnimeTemplateId('[Other] Completely Different Show - 86 [1080p]', '', templates), '')
  assert.equal(matchAnimeTemplateId('[Group] 86 Eighty Six - 01 [1080p]', '', templates), 'full')
  assert.equal(matchAnimeTemplateId('[SuperGroup] Unknown - 01 [1080p]', '', templates), '')
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

ok('Nyaa 多来源命名：标题数字不抢集数，最后一个发布槽位优先', () => {
  assert.equal(
    parseFileName('[LoliHouse] Otome Game Sekai wa Mob ni Kibishii Sekai desu 2 - 08 [WebRip 1080p HEVC-10bit AAC SRTx2].mkv').episode,
    '08'
  )
  assert.equal(
    parseFileName('[SweetSub][藤本樹 17-26][Fujimoto Tatsuki 17-26][07][WebRip][1080P][AVC 8bit]').episode,
    '07'
  )
  assert.equal(
    parseFileName('[SweetSub] VIRGIN PUNK - 01 Clockwork Girl [BDRip 1080p HEVC-10bit].mkv').episode,
    '01'
  )
  assert.equal(parseFileName('[Group] Show - 22(94) [1080p].mkv').episode, '22')
  assert.equal(parseFileName('[Group] 100 Meters [BDRip 1080p].mkv').episode, null)
  assert.equal(parseFileName('[Group] 16bit Sensation Another Layer [BDRip 1080p].mkv').episode, null)
})

ok('合集、特别篇、修订版本和已知数字标题', () => {
  assert.equal(parseFileName('Title [01-12(全集)][1080p]').episode, '01-12')
  assert.equal(parseFileName('Title [01_13][BDRip]').episode, '01-13')
  assert.equal(parseFileName('Title [01-12 精校合集][1080p]').episode, '01-12')
  assert.equal(parseFileName('Title [OVA][BDRip][1080p]').episode, 'OVA')
  assert.equal(parseFileName('Title [SP_02][1080p]').episode, 'SP02')
  const revised = parseFileName('Title [81v2][WebRip 1080p]')
  assert.equal(revised.episode, '81')
  assert.equal(revised.version, 'v2')
  assert.equal(parseFileName('[Group][86][1080p]', undefined, ['86']).episode, null)
})

ok('容器元数据、12bit 与字幕轨数量标记', () => {
  const p = parseFileName('[DMG][Title][01][1080P][12bit][MP4]')
  assert.equal(p.format, 'MP4')
  assert.equal(p.bitDepth, '12bit')
  const muxed = parseFileName('[LoliHouse] Title - 01 [WebRip 1080p HEVC-10bit AAC ASSx2].mkv')
  assert.deepEqual(muxed.languages, [])
  assert.equal(muxed.subtitleType, 'EMBEDDED')
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

console.log('site accounts:')
ok('本地站点默认关闭，配置往返保留用户手动开关', () => {
  const sites = Object.fromEntries(PUBLISH_SITES.map(site => [site, defaultSiteAccount(site)]))
  let data = sanitizeAppData({ groups: [{ id: 'new-group', name: 'new', sites }] })
  assert.ok(PUBLISH_SITES.every(site => !data.groups[0].sites[site].enabled))
  data.groups[0].sites.anibt.enabled = true
  assert.equal(sanitizeAppData(data).groups[0].sites.anibt.enabled, true)
  data.groups[0].sites.anibt.enabled = false
  assert.equal(sanitizeAppData(data).groups[0].sites.anibt.enabled, false)
  data = sanitizeAppData({ groups: [{ id: 'incomplete', sites: {} }] })
  assert.equal(data.groups[0].sites.anibt.enabled, false)
  assert.equal(sanitizeAppData({ groups: [{ id: 'legacy', apiKey: 'test' }] }).groups[0].sites.anibt.enabled, true)
})
ok('空账号不会检查通过，每个站点都有明确的缺失配置提示', () => {
  for (const site of PUBLISH_SITES) {
    assert.ok(siteConfigurationError(site, defaultSiteAccount(site)).length > 0, site)
  }
})
ok('Nyaa 仅接受账号密码 API 配置，Cookie 不能替代凭据', () => {
  const credentials = defaultSiteAccount('nyaa')
  credentials.username = 'user'
  credentials.password = 'pass'
  assert.equal(siteConfigurationError('nyaa', credentials), '')
  assert.equal(isSiteConfigured('nyaa', credentials), true)

  const cookies = defaultSiteAccount('nyaa')
  cookies.cookies.push({
    name: 'session',
    value: 'value',
    domain: '.nyaa.si',
    path: '/',
    secure: true,
    httpOnly: true
  })
  assert.equal(siteConfigurationError('nyaa', cookies), '请先填写用户名和密码')
  assert.equal(isSiteConfigured('nyaa', cookies), false)
})
ok('ACG.RIP 同时接受 tpx 链接与裸 Token，发送前统一为裸 Token', () => {
  assert.equal(normalizeAcgripToken('tpx://acg.rip/7233-px2fff6ks9eeeeee'), '7233-px2fff6ks9eeeeee')
  assert.equal(normalizeAcgripToken('7233-px2fff6ks9eeeeee'), '7233-px2fff6ks9eeeeee')
  assert.equal(normalizeAcgripToken('  TPX://ACG.RIP/7233-abc  '), '7233-abc')
})
ok('ACG.RIP 联盟发布开关只在开启时发送 post_as_team=1', () => {
  const account = defaultSiteAccount('acgrip')
  assert.equal(acgripPostAsTeamValue(account), null)
  account.publishAsTeam = true
  assert.equal(acgripPostAsTeamValue(account), '1')
})
ok('动漫花园应用内登录能区分成功、密码错误和验证码错误', () => {
  assert.deepEqual(evaluateDmhyLoginResponse('<p>登入成功</p>'), { ok: true, message: '登录成功' })
  assert.deepEqual(evaluateDmhyLoginResponse('帳戶密碼錯誤'), { ok: false, message: '账号或密码错误' })
  assert.deepEqual(evaluateDmhyLoginResponse('验证码错误'), { ok: false, message: '验证码错误，请重新输入' })
})
ok('无只读验证端点的站点只标为未验证，不发送伪发布检查', () => {
  for (const site of ['mikan', 'acgrip', 'acgnxAsia', 'acgnxGlobal']) {
    const result = unavailableCredentialCheck(site)
    assert.equal(result.ok, true, site)
    assert.equal(result.verified, false, site)
    assert.match(result.message, /实际发布时验证/, site)
  }
})
ok('代理检测展示的八个站点网址均为 HTTPS', () => {
  assert.deepEqual(Object.keys(SITE_URLS), [...PUBLISH_SITES])
  for (const url of Object.values(SITE_URLS)) assert.match(url, /^https:\/\//)
})

console.log('store-doc:')
ok('默认值完整', () => {
  const d = defaultAppData()
  assert.equal(d.version, 1)
  assert.equal(d.settings.proxy.host, '127.0.0.1')
  assert.equal(d.settings.proxy.port, 7890)
  assert.ok(d.settings.subtitleDetect.rules.length > 0)
  assert.equal(d.settings.subtitleDetect.presetVersion, SUBTITLE_PRESET_VERSION)
  assert.ok(d.titleTemplates.length > 0)
  assert.equal(d.defaultTitleTemplateId, null)
  assert.equal(d.defaultDescTemplateId, null)
  assert.equal(d.settings.publishMode, 'anibt')
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
  assert.equal(out.groups[0].sites.anibt.apiKey, 'k')
  assert.equal(out.groups[0].sites.anibt.enabled, true)
  assert.equal(out.records[0].subtitle, 'EMBEDDED')
  assert.equal(out.records[0].version, 'v1')
  assert.equal(out.records[0].nyaaCategory, '1_3')
  assert.equal(sanitizeAppData({ records: [{ nyaaCategory: '1_2' }] }).records[0].nyaaCategory, '1_2')
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
ok('AniBT 网页会话：验证码 Cookie、空对象、畸形返回均不代表登录成功', () => {
  for (const bad of [null, undefined, '', 123, [], {}, { user: {} }, { user: { id: 'u' } }, { user: { id: 1 }, session: { id: 's' } }, { user: { id: 'u' }, session: { id: '' } }]) {
    assert.equal(hasAnibtWebSession(bad), false)
  }
  assert.equal(hasAnibtWebSession({ user: { id: 'u' }, session: { id: 's' } }), true)
  assert.equal(isAnibtWebUrl('https://anibt.net/groups'), true)
  for (const url of ['https://anibt.net.evil.test', 'http://anibt.net', 'file:///groups', 'javascript:alert(1)', 'invalid']) assert.equal(isAnibtWebUrl(url), false)
})
ok('独立 AniBT 网页账号在没有发布组时仍可加密还原，损坏 Cookie 可安全回退', () => {
  const original = { username: 'probe@example.invalid', password: 'probe-password', userAgent: 'probe-ua',
    cookies: [{ name: 'session', value: 'web-secret', domain: 'anibt.net', path: '/', secure: true, httpOnly: true }] }
  const secrets = openSecrets(sealSecrets(collectSecrets([], original)))
  const restored = defaultAppData().anibtWebAccount
  mergeSecrets([], secrets, restored)
  assert.deepEqual(restored, original)
  assert.equal(sanitizeAppData({ anibtWebAccount: original }).anibtWebAccount.password, original.password)
  for (const bad of ['{', 'null', '42', '[null,{},"garbage"]']) {
    const doc = defaultAppData()
    mergeSecrets([], { 'anibtWeb/cookies': bad }, doc.anibtWebAccount)
    assert.deepEqual(sanitizeAppData(doc).anibtWebAccount.cookies, [])
  }
})
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
ok('多站点敏感字段抽离、Nyaa 旧 Cookie 丢弃、其余字段可还原', () => {
  const doc = sanitizeAppData({ groups: [{ id: 'a', name: 'A', apiKey: 'legacy-key' }] })
  const group = doc.groups[0]
  group.sites.mikan.apiToken = 'mikan-token'
  group.sites.nyaa.username = 'name'
  group.sites.nyaa.password = 'pass'
  group.sites.dmhy.cookies = [{ name: 'session', value: 'cookie', domain: '.dmhy.org', path: '/', secure: true, httpOnly: true }]
  const secrets = collectSecrets(doc.groups)
  assert.equal(secrets['a/anibt/apiKey'], 'legacy-key')
  assert.equal(secrets['a/mikan/apiToken'], 'mikan-token')
  assert.equal(secrets['a/nyaa/cookies'], undefined)
  assert.ok(secrets['a/dmhy/cookies'].includes('cookie'))
  const redacted = redactSecrets(doc.groups)
  assert.equal(redacted[0].sites.anibt.apiKey, '')
  assert.equal(redacted[0].sites.nyaa.password, '')
  assert.deepEqual(redacted[0].sites.dmhy.cookies, [])
  secrets['a/nyaa/cookies'] = JSON.stringify([{ name: 'legacy', value: 'old' }])
  mergeSecrets(redacted, secrets)
  assert.equal(redacted[0].sites.mikan.apiToken, 'mikan-token')
  assert.equal(redacted[0].sites.dmhy.cookies[0].value, 'cookie')
  assert.deepEqual(redacted[0].sites.nyaa.cookies, [])
})
ok('默认模板 ID 只保留仍存在的模板', () => {
  const valid = sanitizeAppData({
    titleTemplates: [{ id: 'title-a', name: 'A', template: 'A' }],
    descTemplates: [{ id: 'desc-a', name: 'A', markdown: 'A' }],
    defaultTitleTemplateId: 'title-a',
    defaultDescTemplateId: 'desc-a'
  })
  assert.equal(valid.defaultTitleTemplateId, 'title-a')
  assert.equal(valid.defaultDescTemplateId, 'desc-a')
  const stale = sanitizeAppData({ defaultTitleTemplateId: 'missing', defaultDescTemplateId: 'missing' })
  assert.equal(stale.defaultTitleTemplateId, null)
  assert.equal(stale.defaultDescTemplateId, null)
})

console.log('subtitle preset updates:')
ok('更新预设只补新词，不覆盖同名用户规则或其他自定义词', () => {
  const custom = [
    { word: '簡繁日內嵌', langs: ['EN'], type: 'EXTERNAL' },
    { word: '我的自定义词', langs: ['CHS'], type: null }
  ]
  const result = updateSubtitlePresets(custom, 1)
  assert.equal(result.presetVersion, SUBTITLE_PRESET_VERSION)
  assert.deepEqual(result.rules.find((rule) => rule.word === '簡繁日內嵌'), custom[0])
  assert.ok(result.rules.some((rule) => rule.word === '我的自定义词'))
  assert.ok(result.rules.some((rule) => rule.word === '簡繁日外掛'))
  assert.ok(result.added > 0)
  assert.equal(updateSubtitlePresets(result.rules, result.presetVersion).added, 0)
})

console.log('DMHY publishing identities:')
const dmhyForm = `<select name="sort_id"><option value="2" label="动画">动画</option></select>
  <select id='team_id' name = 'team_id'>
    <option value='0' label='个人发布'>个人发布</option>
    <option selected value = '23' label=' 测试 &amp; 发布组 '>ignored</option>
    <option value=42>&#x793a;&#20363;字幕组</option>
    <option value=99 disabled>不可用</option>
  </select>`
ok('DMHY 仅解析 team_id，支持 label/文本/实体/属性空格，保留个人身份 0', () => {
  const identities = parseDmhyIdentities(dmhyForm)
  assert.deepEqual(identities, [
    { id: '0', name: '个人发布', selected: false },
    { id: '23', name: '测试 & 发布组', selected: true },
    { id: '42', name: '示例字幕组', selected: false }
  ])
  assert.equal(selectDmhyIdentity(identities, ' 测试　& 发布组 ')?.id, '23')
  assert.equal(selectDmhyIdentity(identities, '示例字幕组')?.id, '42')
  assert.equal(selectDmhyIdentity(identities, '个人发布')?.id, '0')
  assert.equal(selectDmhyIdentity(identities, '  ')?.id, '23')
  assert.equal(selectDmhyIdentity(identities, '动画'), undefined)
  assert.equal(selectDmhyIdentity(identities, '错误名字'), undefined)
})
ok('DMHY 畸形/截断 HTML 不误选；忽略注释脚本和 textarea，兼容省略 option 结束标签', () => {
  for (const html of ['', '\u0000\ufffdgarbage', '<select name=team_id><option value="23', '<select name=team_id disabled><option value=1>组</option></select>']) {
    assert.deepEqual(parseDmhyIdentities(html), [])
  }
  const fake = '<select name=team_id><option value=999>错误组</option></select>'
  assert.deepEqual(parseDmhyIdentities(`<!--${fake}--><script>${fake}</script><textarea>${fake}</textarea>${dmhyForm}`), parseDmhyIdentities(dmhyForm))
  assert.deepEqual(parseDmhyIdentities('<SELECT NAME=team_id><OPTION VALUE=1>A<OPTION VALUE=2>B</SELECT>'), [
    { id: '1', name: 'A', selected: false }, { id: '2', name: 'B', selected: false }
  ])
  assert.doesNotThrow(() => parseDmhyIdentities('<select name=team_id><option value=1>&#x110000; &#99999999999;</option></select>'))
  const entities = parseDmhyIdentities('<select name=team_id><option value="3" label="A &gt; B &quot;C&quot; &amp;amp;">x</option></select>')
  assert.equal(entities[0].name, 'A > B "C" &amp;')
})
ok('DMHY 检查按 Cookie 主机/路径/有效期筛选，不把 www 会话伪装成 share 会话', () => {
  const cookie = { name: 'session', value: 'fixture', domain: 'www.dmhy.org', path: '/', secure: true, httpOnly: true }
  const cookies = [cookie,
    { ...cookie, name: 'common', domain: '.dmhy.org' },
    { ...cookie, name: 'expired', expirationDate: 50 },
    { ...cookie, name: 'otherPath', path: '/user' },
    { ...cookie, name: 'wrong', domain: 'dmhy.org.invalid' }
  ]
  assert.equal(dmhyCookieHeader(cookies, 'https://www.dmhy.org/topics/add', 100), 'session=fixture; common=fixture')
  assert.equal(dmhyCookieHeader(cookies, 'https://share.dmhy.org/topics/add', 100), 'common=fixture')
  assert.equal(dmhyCookieHeader(cookies, 'https://outside.invalid/topics/add', 100), '')
})
ok('DMHY 发布记录兼容响应页/列表页链接格式和 HTML 实体', () => {
  const title = '[测试组] 我们的雨色协议 - 01 [1080p]'
  const html = `<a href="/topics/view/123_test.html" target="_blank"><span>${title.replace(/ /g, '&nbsp;')}</span></a>
    <a target='_blank' href='/topics/edit/id/999'>其他内容</a>`
  assert.equal(extractDmhyTopicLink(html, title, 'https://www.dmhy.org'), 'https://www.dmhy.org/topics/view/123_test.html')
  assert.equal(extractDmhyTopicLink(`<a href='/topics/view/123_test.html'>${title}</a>`, title, 'https://share.dmhy.org'), 'https://share.dmhy.org/topics/view/123_test.html')
  assert.equal(extractDmhyTopicLink('<a href="/topics/view/123_test.html">完全不同</a>', title, 'https://www.dmhy.org'), undefined)
})
{
  const visited = []
  const result = await loadDmhyPublishContext(async url => {
    visited.push(url)
    return new Response(dmhyForm)
  }, '示例字幕组')
  ok('DMHY 发布/检查优先使用与账号登录相同的 www 主机', () => {
    assert.deepEqual(visited, ['https://www.dmhy.org/topics/add'])
    assert.deepEqual(result, { ok: true, url: visited[0], teamId: '42', identityName: '示例字幕组' })
  })
}
{
  const visited = []
  const result = await loadDmhyPublishContext(async url => {
    visited.push(url)
    return new Response(url.includes('www.') ? '登入發佈系統' : dmhyForm)
  }, '示例字幕组')
  ok('DMHY 兼容旧 share 会话且后续提交仍使用成功读取身份的主机', () => {
    assert.equal(visited.length, 2)
    assert.equal(result.ok, true)
    assert.equal(result.url, 'https://share.dmhy.org/topics/add')
    assert.equal(result.teamId, '42')
  })
}
{
  const wrongName = await loadDmhyPublishContext(async () => new Response(dmhyForm), '不存在')
  const login = await loadDmhyPublishContext(async () => new Response('登入發佈系統'), '示例字幕组')
  const challenge = await loadDmhyPublishContext(async () => new Response('<title>Just a moment...</title>', { status: 403 }), '')
  const empty = await loadDmhyPublishContext(async () => new Response('<h1>Unrecognized page</h1>'), '')
  ok('DMHY 分别报告身份不匹配、登录失效、人机验证和缺失表单，不能假通过', () => {
    for (const result of [wrongName, login, challenge, empty]) assert.equal(result.ok, false)
    assert.match(wrongName.error, /当前账号可用身份.*示例字幕组/)
    assert.match(login.error, /登录已失效/)
    assert.match(challenge.error, /需要网页验证/)
    assert.match(empty.error, /发布权限/)
  })
}

console.log('mikan search matching:')
ok('Mikan 作品链接使用 info hash；不使用发布组主页，支持大写 hash 并拒绝畸形值', () => {
  const hash = 'cc93508d7cae1b5227126cb6954929d856a6b43e'
  assert.equal(mikanEpisodeUrl(hash.toUpperCase()), `https://mikanani.me/Home/Episode/${hash}`)
  for (const invalid of ['', '984', 'a'.repeat(39), 'x'.repeat(40), '../group']) assert.throws(() => mikanEpisodeUrl(invalid))
  // Hash the exact info bytes, not the full torrent or a re-encoded/sorted dictionary.
  const rawInfo = 'd4:name4:Test6:lengthi1ee'
  const bytes = Buffer.from(`d4:info${rawInfo}e`)
  const expected = createHash('sha1').update(rawInfo).digest('hex')
  const hashFromUpload = createHash('sha1').update(parseTorrent(bytes).infoRaw).digest('hex')
  assert.equal(mikanEpisodeUrl(hashFromUpload), `https://mikanani.me/Home/Episode/${expected}`)
})
ok('Mikan 番剧搜索响应提取自有 ID、标题和 bgm.tv subject id', () => {
  assert.deepEqual(parseMikanSearchItems('bangumi', [{
    BangumiId: 3169,
    ChsName: '我们的雨色协议',
    JpnName: '僕らの雨いろプロトコル',
    BangumiUrl: 'https://bgm.tv/subject/444634'
  }]), [{
    id: 3169,
    name: '我们的雨色协议',
    secondaryName: '僕らの雨いろプロトコル',
    bgmId: 444634
  }])
})
ok('Mikan 自动匹配优先使用 bgm.tv subject id，不盲取模糊搜索第一条', () => {
  const rows = [
    { id: 1, name: '同名错误项', bgmId: 111 },
    { id: 3169, name: '我们的雨色协议', secondaryName: '僕らの雨いろプロトコル', bgmId: 444634 }
  ]
  assert.equal(selectMikanBangumiMatch(rows, 444634, ['我们的雨色协议'])?.id, 3169)
  assert.equal(selectMikanBangumiMatch(rows, 999999, ['不存在的标题']), null)
})
ok('Mikan 旧响应无 bgm.tv id 时只接受完整标题匹配', () => {
  const rows = [{ id: 3169, name: '我们的雨色协议', secondaryName: '僕らの雨いろプロトコル' }]
  assert.equal(selectMikanBangumiMatch(rows, 444634, ['我们的雨色协议'])?.id, 3169)
  assert.equal(selectMikanBangumiMatch(rows, 444634, ['我们的雨色']), null)
})

console.log('description formats:')
ok('markdown-it 转 HTML，结构保留且原始 HTML 不透传', () => {
  const html = markdownToHtml('---\n\n**bold** [link](https://example.com) <script>x</script>')
  assert.match(html, /<hr>/)
  assert.match(html, /<strong>bold<\/strong>/)
  assert.match(html, /href="https:\/\/example.com"/)
  assert.ok(!html.includes('<script>'))
})
ok('Markdown 转蜜柑 BBCode 覆盖分隔线、粗体、链接和图片', () => {
  const bbcode = markdownToBbcode('---\n\n**bold** [link](https://example.com)\n\n![](https://example.com/a.jpg)')
  assert.match(bbcode, /\[hr\]/)
  assert.match(bbcode, /\[b\]bold\[\/b\]/)
  assert.match(bbcode, /\[url=https:\/\/example.com\]link\[\/url\]/)
  assert.match(bbcode, /\[img\]https:\/\/example.com\/a.jpg\[\/img\]/)
})
ok('Mikan BBCode 使用 SCEditor 兼容的嵌套列表、表格和代码块标签', () => {
  const source = [
    '# 标题',
    '',
    '- 外层',
    '  1. 内层',
    '',
    '| 角色 | 特点 |',
    '| --- | --- |',
    '| 星野日向 | 喜欢白咲花 |',
    '',
    '> 引用',
    '',
    '[参考][id]',
    '',
    '[id]: https://example.com "标题"',
    '    const x = 1',
    '    return x',
    '',
    'Setext',
    '===',
  ].join('\n')
  const bbcode = markdownToBbcode(source)
  assert.match(bbcode, /^\[size=4\]\[b\]标题\[\/b\]\[\/size\]/)
  assert.match(bbcode, /\[ul\]\n\[li\]外层\n\[ol\]\n\[li\]内层\[\/li\]\n\[\/ol\]\[\/li\]\n\[\/ul\]/)
  assert.match(bbcode, /\[table\]\n\[tr\]\[th\]角色\[\/th\]\[th\]特点\[\/th\]\[\/tr\]/)
  assert.match(bbcode, /\[td\]星野日向\[\/td\]\[td\]喜欢白咲花\[\/td\]/)
  assert.match(bbcode, /\[quote\]引用\[\/quote\]/)
  assert.match(bbcode, /\[url=https:\/\/example.com\]参考\[\/url\]/)
  assert.match(bbcode, /\[code\]const x = 1\nreturn x\[\/code\]/)
  assert.match(bbcode, /\[size=4\]\[b\]Setext\[\/b\]\[\/size\]/)
  assert.ok(!bbcode.includes('[list=1]'))
})
ok('ACG.RIP 使用 markdown 包裹；Mikan payload 永不含 trackers', () => {
  assert.equal(formatDescription('acgrip', 'hello'), '[markdown]\n\nhello\n\n[/markdown]')
  const body = buildMikanRequestBody({
    title: 'T', torrentBase64: 'AA==', descriptionBbcode: '[b]x[/b]',
    bangumiId: 3599, subtitleGroupId: 1208, publishGroupId: 984
  })
  assert.deepEqual(body, {
    name: 'T', torrentBase64: 'AA==', description: '[b]x[/b]',
    bangumiId: 3599, subtitleGroupId: 1208, publishGroupId: 984
  })
  assert.equal(Object.hasOwn(body, 'trackers'), false)
})

console.log(`\n全部通过：${passed} 项`)
