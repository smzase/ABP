/**
 * UI 冒烟探针：启动打包后的主进程，程序化驱动真实窗口，断言容易「静默坏掉」的 UI 不变量。
 *
 * 为什么需要它：reka-ui 的 TooltipRoot 缺少 TooltipProvider 时会抛注入错误，
 * 被包住的那段 UI 直接消失 —— lint / typecheck / 单测全绿，但按钮没了。
 * 这类问题只有真正把窗口跑起来数 DOM 才抓得到。
 *
 * 用法（Windows PowerShell）：
 *   $env:ELECTRON_RUN_AS_NODE=$null   # 本环境默认带这个变量，会让 electron.exe 退化成 node
 *   npm run build
 *   npm run probe
 *
 * 注意：配置目录被重定向到系统临时目录，不会碰用户 Documents 下的真实配置。
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { app, BrowserWindow, session } = require('electron')

// ---- 配置目录隔离：必须在 require 主进程之前改，否则 store.load() 已经读过真实目录了
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'abp-ui-probe-'))
app.setPath('documents', sandbox)
app.setPath('userData', sandbox)
app.once('ready', () => {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (_details, callback) => callback({ cancel: true })
  )
})

require(path.join(__dirname, '..', 'out', 'main', 'index.js'))

const errors = []
const results = []
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail })
}

const js = (win, code) => win.webContents.executeJavaScript(code)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 轮询等待某个条件成立，超时才放弃。
 *
 * 固定 sleep 是这条探针最大的不稳定来源：写短了偶发失败（机器忙一点就跟不上），
 * 写长了每次都白等。更糟的是失败会**串**——弹窗晚关一拍，遮罩还在，
 * 后面那几次点击就全落在遮罩上，报出来的却是「Preview 开关没打开」这种离现场很远的错。
 * 轮询让常见情况下几乎不等，慢的时候也能等够。
 */
async function waitFor(win, expr, { timeout = 6000, interval = 120 } = {}) {
  const deadline = Date.now() + timeout
  for (;;) {
    const ok = await js(win, `(async()=>{ try { return !!(await (${expr})) } catch { return false } })()`)
    if (ok) return true
    if (Date.now() >= deadline) return false
    await wait(interval)
  }
}

/**
 * 按可见文字点按钮。找不到就返回 false，绝不抛 —— 一个 throw 会静默掐断整条探针链。
 * root 默认限定在 'main'：侧边栏导航项和页内 tab 常常同名（如「番剧模板」），
 * 不限定范围会先点到侧边栏。
 */
function clickByText(win, text, { exact = false, last = false, root = 'main' } = {}) {
  const lit = JSON.stringify(text)
  const rootLit = JSON.stringify(root)
  return js(
    win,
    `(()=>{ try {
      const scope=document.querySelector(${rootLit}); if(!scope) return false
      const all=[...scope.querySelectorAll('button')].filter(b=>{
        const t=b.textContent.replace(/\\s+/g,' ').trim()
        return ${exact} ? t===${lit} : t.includes(${lit})
      })
      const el=${last} ? all[all.length-1] : all[0]
      if(!el) return false
      el.click(); return true
    } catch { return false } })()`
  )
}

/** 按 placeholder 聚焦输入框，可选把光标放到开头 / 全选。返回当前值，找不到返回 null */
function focusByPlaceholder(win, placeholder, { caretStart = false, select = false } = {}) {
  const lit = JSON.stringify(placeholder)
  return js(
    win,
    `(()=>{ try {
      const el=[...document.querySelectorAll('input,textarea')].find(e=>e.placeholder&&e.placeholder.includes(${lit}))
      if(!el) return null
      el.focus()
      if(${select}) el.select()
      else if(${caretStart}) el.setSelectionRange(0,0)
      return el.value
    } catch { return null } })()`
  )
}

function valueByPlaceholder(win, placeholder) {
  const lit = JSON.stringify(placeholder)
  return js(
    win,
    `(()=>{ try {
      const el=[...document.querySelectorAll('input,textarea')].find(e=>e.placeholder&&e.placeholder.includes(${lit}))
      return el?el.value:null
    } catch { return null } })()`
  )
}

function typeText(win, text) {
  for (const ch of text) win.webContents.sendInputEvent({ type: 'char', keyCode: ch })
  return wait(350)
}

function pressKey(win, keyCode) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode })
  return wait(250)
}

async function editMarkdown(win, text) {
  if (!(await waitFor(win, `document.querySelector('.md-editor .cm-content')`))) return false
  await js(win, `(()=>{const e=document.querySelector('.md-editor .cm-content'); e.scrollIntoView({block:'center'}); e.focus()})()`)
  await win.webContents.insertText(text)
  return waitFor(win, `document.querySelector('.md-editor-preview')?.textContent.includes(${JSON.stringify(text)})`)
}

function nav(win, index) {
  return js(
    win,
    `(()=>{const b=document.querySelectorAll('aside nav button')[${index}]; if(!b) return false; b.click(); return true})()`
  )
}

/**
 * 按可见文字点 reka-ui 的下拉触发器。
 * 注意：reka 的 SelectTrigger 监听的是 **pointerdown**，不是 click ——
 * 用 el.click() 弹层根本不会开，断言就会得到一个空列表。
 */
function openSelectByText(win, text) {
  const lit = JSON.stringify(text)
  return js(
    win,
    `(()=>{ try {
      const b=[...document.querySelectorAll('main button[role=combobox]')].find(x=>x.textContent.includes(${lit}))
      if(!b) return false
      b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,pointerType:'mouse'}))
      b.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,button:0,pointerType:'mouse'}))
      return true
    } catch { return false } })()`
  )
}

/** 把鼠标移到某元素中心（真实输入事件，用于触发 hover 类交互） */
async function hoverSelector(win, selector) {
  const lit = JSON.stringify(selector)
  const r = await js(
    win,
    `(()=>{const e=document.querySelector(${lit}); if(!e) return null
      const r=e.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)}})()`
  )
  if (!r) return false
  win.webContents.sendInputEvent({ type: 'mouseMove', x: r.x, y: r.y })
  await wait(900)
  return true
}

/**
 * 真实鼠标点击某个元素（先拿到坐标再发 mouseDown/mouseUp）。
 * reka 的下拉选项对合成事件挑食：dispatchEvent 出来的 pointerdown 能让它高亮，
 * 却不会真的选中。要断言「选完之后内容被套用」就得走真实输入事件这条路。
 *
 * 坐标在发事件的前一刻重新取一次：中间若有重渲染（打字、patch、列表重排），
 * 旧坐标就指到别处去了 —— 点空一次，后面一串断言跟着错，报出来的还是别的名字。
 */
async function clickElementAt(win, expr) {
  const rect = () =>
    js(
      win,
      `(()=>{ try { const e=${expr}; if(!e) return null
        const b=e.getBoundingClientRect()
        if(b.width===0||b.height===0) return null
        return {x:Math.round(b.left+b.width/2), y:Math.round(b.top+b.height/2)}
      } catch { return null } })()`
    )
  if (!(await rect())) return false
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 0, y: 0 })
  await wait(60)
  const r = await rect()
  if (!r) return false
  win.webContents.sendInputEvent({ type: 'mouseMove', x: r.x, y: r.y })
  await wait(120)
  win.webContents.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1 })
  win.webContents.sendInputEvent({ type: 'mouseUp', x: r.x, y: r.y, button: 'left', clickCount: 1 })
  await wait(300)
  return true
}

/**
 * 出站 payload 必须先过 toPlain。
 * Vue 的响应式对象是 Proxy，结构化克隆（contextBridge / ipcRenderer）不认它，
 * 直接送会抛「An object could not be cloned.」—— 而且报错里看不出是哪个字段。
 * 机制本身在单测里用真 Vue reactive 断言过；这里只防「有人手滑把 toPlain 删了」。
 */
function bundleHasPlainGuard() {
  const dir = path.join(__dirname, '..', 'out', 'renderer', 'assets')
  if (!fs.existsSync(dir)) return false
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .some((f) => {
      const src = fs.readFileSync(path.join(dir, f), 'utf-8')
      if (!src.includes('anibtPublish')) return false
      // 允许压缩后改名，但 anibtPublish( 之后必须紧跟一次函数调用而不是对象字面量
      return /anibtPublish\(\s*[A-Za-z_$][\w$]*\(/.test(src)
    })
}

/**
 * 扫构建产物里有没有残留的原生确认框调用。
 * window.confirm 在 Electron 里是系统模态窗口，关掉之后键盘焦点常常回不到 webContents，
 * 之后整个窗口的输入框都变成「能删、打不进去」。一律走 lib/confirm.ts 的应用内弹窗。
 */
function bundleUsesNativeConfirm() {
  const dir = path.join(__dirname, '..', 'out', 'renderer', 'assets')
  if (!fs.existsSync(dir)) return false
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .some((f) => /(window|globalThis)\s*\.\s*confirm\s*\(/.test(fs.readFileSync(path.join(dir, f), 'utf-8')))
}

async function run(win) {
  // Inspect parsed modules: file:// resources do not appear in PerformanceResourceTiming.
  const scripts = new Set()
  const onScript = (_event, method, params) => {
    if (method === 'Debugger.scriptParsed' && params.url) scripts.add(params.url)
  }
  win.webContents.debugger.attach('1.3')
  win.webContents.debugger.on('message', onScript)
  try {
    await win.webContents.debugger.sendCommand('Debugger.enable')
    const editorScripts = [...scripts].filter(url => /\/(?:codemirror|md-editor|UiMarkdownEditor)-[^/]+\.js$/.test(url))
    check('发布首屏不加载 Markdown / CodeMirror', editorScripts.length === 0, JSON.stringify(editorScripts))
    check('模块加载检查实际捕获到首屏脚本', [...scripts].some(url => /\/PublishView-[^/]+\.js$/.test(url)))
  } finally {
    win.webContents.debugger.off('message', onScript)
    win.webContents.debugger.detach()
  }

  // ---------- 外观：默认浅色 ----------
  check('默认浅色模式（html 上没有 .dark）', !(await js(win, `document.documentElement.classList.contains('dark')`)))

  // ---------- 侧边栏：展开时不再浮出重复的导航气泡 ----------
  // 展开态按钮上已经写着「发布 / 番剧模板 / …」，再浮一层同样的字是纯噪音。
  // 注意不能靠 trigger 上有没有 data-state 来判断 —— reka 的 TooltipTrigger
  // 即使 disabled 也照样带 data-state="closed"。只能真的把鼠标移上去数气泡。
  const sideBar = await js(
    win,
    `(()=>{const a=document.querySelector('aside'); if(!a) return null
      const btns=[...a.querySelectorAll('nav button')]
      return {w:Math.round(a.getBoundingClientRect().width), n:btns.length,
        labeled:btns.filter(b=>b.textContent.trim().length>0).length}})()`
  )
  check('侧边栏展开且导航项带文字', sideBar && sideBar.n === 5 && sideBar.labeled === 5, JSON.stringify(sideBar))
  check('展开时侧边栏更窄（w-40 = 160px）', sideBar && sideBar.w === 160, sideBar && `width=${sideBar.w}`)
  check('悬停展开态导航项：不弹气泡', (await hoverSelector(win, 'aside nav button')) && (await js(win, `document.querySelectorAll('[role=tooltip]').length`)) === 0)
  // 收起后必须还弹 —— 那时按钮只剩图标，气泡是唯一的说明
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 640, y: 430 })
  await wait(300)
  check(
    '收起侧边栏',
    await clickElementAt(win, `document.querySelector('aside > div:last-child > button')`)
  )
  await wait(700)
  const collapsedW = await js(win, `Math.round(document.querySelector('aside').getBoundingClientRect().width)`)
  check('收起后侧边栏只剩图标宽度（56px）', collapsedW === 56, `width=${collapsedW}`)
  check('悬停收起态导航项：弹出气泡', (await hoverSelector(win, 'aside nav button')) && (await js(win, `document.querySelectorAll('[role=tooltip]').length`)) >= 1)
  // 复原，后面的断言按展开态写的
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 640, y: 430 })
  await wait(300)
  await clickElementAt(win, `document.querySelector('aside > div:last-child > button')`)
  await wait(700)

  // ---------- 发布页：投放区居中且整块可点 ----------
  await nav(win, 0)
  await wait(700)
  const drop = await js(
    win,
    `(()=>{const b=document.querySelector('main button.border-dashed');
      if(!b) return null; const r=b.getBoundingClientRect();
      return {tag:b.tagName, h:Math.round(r.height), inner:b.querySelectorAll('button').length}})()`
  )
  check('投放区是可点击按钮', drop && drop.tag === 'BUTTON', JSON.stringify(drop))
  check('投放区撑满内容区（居中而非贴顶）', drop && drop.h > 400, drop && `height=${drop.h}`)
  check('投放区内不再嵌「选择文件」链接', drop && drop.inner === 0, drop && `inner=${drop.inner}`)
  // 队列空时不该出现「上一步」：那意味着还停在阶段二的空页面上
  check(
    '空队列时停在第一步（阶段二删空会自动退回）',
    !(await js(win, `[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='上一步')`))
  )

  // ---------- 番剧模板页：tab 顺序 + 默认 tab ----------
  await nav(win, 1)
  await wait(1100)
  const tabs = await js(
    win,
    `(()=>{const box=document.querySelector('main .bg-secondary'); if(!box) return null
      return [...box.querySelectorAll('button')].map(b=>b.textContent.trim())})()`
  )
  check(
    '「番剧模板」排在第一个',
    Array.isArray(tabs) && tabs[0] === '番剧模板' && tabs[1] === '标题模板' && tabs[2] === '简介模板',
    JSON.stringify(tabs)
  )
  // 默认就停在番剧模板：这页的主角是它，标题/简介模板是被它引用的素材
  check(
    '默认打开的就是「番剧模板」tab',
    await js(
      win,
      `(()=>{const box=document.querySelector('main .bg-secondary'); if(!box) return false
        const b=[...box.querySelectorAll('button')].find(x=>x.textContent.trim()==='番剧模板')
        return !!b && b.className.includes('bg-card')})()`
    )
  )

  // ---------- 标题模板：变量面板默认全展开且有变量 ----------
  check('切到「标题模板」tab', await clickByText(win, '标题模板', { exact: true }))
  await wait(900)
  const states = await js(
    win,
    `[...document.querySelectorAll('main [data-state][aria-expanded]')].map(e=>e.getAttribute('data-state'))`
  )
  check('五组变量默认全展开', states.length >= 5 && states.every((s) => s === 'open'), JSON.stringify(states))
  const varCount = await js(win, `document.querySelectorAll('button.font-mono').length`)
  check('变量按钮渲染出来了（曾因缺 TooltipProvider 全部消失）', varCount >= 23, `count=${varCount}`)
  check('模板内容框是 textarea（长模板换行而非横向滚）', await js(win, `!!document.querySelector('textarea.font-mono')`))
  // 简繁两个标题变量要能在面板里点得到
  const titleVars = await js(
    win,
    `[...document.querySelectorAll('button.font-mono')].map(b=>b.textContent.trim())`
  )
  check(
    '变量面板有 {{titleZhHans}} / {{titleZhHant}}',
    Array.isArray(titleVars) &&
      titleVars.includes('{{titleZhHans}}') &&
      titleVars.includes('{{titleZhHant}}'),
    JSON.stringify(titleVars && titleVars.slice(0, 8))
  )

  // ---------- 三个 tab 的左侧列表宽度一致 ----------
  const sideWidth = (sel) =>
    js(win, `(()=>{const e=document.querySelector(${JSON.stringify(sel)}); return e?Math.round(e.getBoundingClientRect().width):null})()`)
  const wTitle = await sideWidth('main .border-r')
  check('切到「简介模板」tab', await clickByText(win, '简介模板', { exact: true }))
  await wait(600)
  const wDesc = await sideWidth('main .border-r')
  check('创建用于回归测试的简介模板', await clickByText(win, '添加简介模板', { exact: true }))
  check('简介模板异步编辑器可以输入并实时预览', await editMarkdown(win, 'ABP desc roundtrip'))
  check('简介模板的异步 v-model 已保存', await waitFor(win,
    `window.api.loadStore().then(data => data.descTemplates.some(t => t.markdown.includes('ABP desc roundtrip')))`))
  await clickByText(win, '标题模板', { exact: true })
  await waitFor(win, `!document.querySelector('.md-editor')`)
  await clickByText(win, '简介模板', { exact: true })
  check('简介模板重新打开后内容仍在', await waitFor(win,
    `document.querySelector('.md-editor .cm-content')?.textContent.includes('ABP desc roundtrip')`))
  // ---------- 番剧模板：bgmId 输入不再被吞 + 繁化姬按钮 ----------
  check('切到「番剧模板」tab', await clickByText(win, '番剧模板', { exact: true }))
  await wait(600)
  const wAnime = await sideWidth('main .border-r')
  check(
    '三个 tab 的左侧列表宽度一致（番剧模板曾经更宽）',
    wTitle !== null && wTitle === wDesc && wDesc === wAnime,
    `title=${wTitle} desc=${wDesc} anime=${wAnime}`
  )
  // 「添加番剧模板」按钮和对话框都在 body 层（Dialog 走 Portal），这里放开 root
  check('打开「添加番剧模板」', await clickByText(win, '添加番剧模板'))
  await wait(900)
  check('聚焦手动 bgmId 输入框', (await focusByPlaceholder(win, '手动输入')) !== null)
  await typeText(win, '400602')
  check('提交新建', await clickByText(win, '添加', { exact: true, last: true, root: 'body' }))
  await wait(1400)

  const bgmField = await focusByPlaceholder(win, '400602', { caretStart: true })
  check('番剧模板已创建，bgmId 回填', bgmField === '400602', `value=${bgmField}`)
  // 在开头插入一个非法字符：以前会把整格清空
  await typeText(win, 'x')
  const afterJunk = await valueByPlaceholder(win, '400602')
  check('bgmId 输入非法字符不会清空整格', afterJunk === 'x400602', `value=${afterJunk}`)

  check(
    '繁化姬「转繁体」按钮可见（曾因缺 TooltipProvider 消失）',
    await js(win, `[...document.querySelectorAll('button')].some(b=>b.textContent.includes('转繁体'))`)
  )
  check('番剧标题模板是 textarea', await js(win, `document.querySelectorAll('textarea.font-mono').length >= 1`))

  // ---------- 番剧模板：种子名示例的固定头部与两层布局 ----------
  await js(win, "document.querySelector('[data-probe=filename-examples]')?.scrollIntoView({block:'center'})")
  await wait(300)
  const examplesCollapsed = await js(
    win,
    "(()=>{const root=document.querySelector('[data-probe=filename-examples]');" +
      "const header=root?.querySelector('[data-probe=filename-examples-header]');" +
      "const nyaa=root?.querySelector('[data-probe=nyaa-proxy-fixed]');" +
      "const trigger=root?.querySelector('[data-probe=filename-examples-trigger]');" +
      "const content=root?.querySelector('[data-probe=filename-examples-content]');" +
      "if(!root||!header||!nyaa||!trigger)return null;" +
      "const nr=nyaa.getBoundingClientRect(),tr=trigger.getBoundingClientRect();" +
      "return {state:trigger.getAttribute('data-state'),icon:!!trigger.querySelector('svg')," +
      "sameHeader:header.contains(nyaa)&&header.contains(trigger)," +
      "sameRow:Math.abs((nr.top+nr.height/2)-(tr.top+tr.height/2))<=2," +
      "nyaaVisible:nr.width>0&&nr.height>0,nyaaInContent:content?content.contains(nyaa):false}})()"
  )
  check(
    '种子名示例默认收起，Nyaa 代发仍固定可见',
    examplesCollapsed && examplesCollapsed.state === 'closed' && examplesCollapsed.nyaaVisible &&
      examplesCollapsed.sameHeader && examplesCollapsed.sameRow && !examplesCollapsed.nyaaInContent,
    JSON.stringify(examplesCollapsed)
  )
  check(
    '「种子名示例」按钮左侧有展开收起图标',
    examplesCollapsed && examplesCollapsed.icon === true,
    JSON.stringify(examplesCollapsed)
  )
  await js(win, `document.querySelector('[data-probe=filename-examples-trigger]').scrollIntoView({block:'center',behavior:'instant'})`)
  check(
    '展开「种子名示例」',
    await clickElementAt(win, "document.querySelector('[data-probe=filename-examples-trigger]')")
  )
  check('种子名示例已展开且内容已挂载', await waitFor(win,
    "document.querySelector('[data-probe=filename-examples-trigger]')?.getAttribute('data-state')==='open' && document.querySelector('[data-example-row]')"))
  const examplesLayout = await js(
    win,
    "(()=>{const root=document.querySelector('[data-probe=filename-examples]');" +
      "const row=root?.querySelector('[data-example-row]');const file=row?.querySelector('[data-example-filename]');" +
      "const meta=row?.querySelector('[data-example-metadata]');const nyaa=root?.querySelector('[data-probe=nyaa-proxy-fixed]');" +
      "const content=meta?.closest('[data-state=open]');if(!root||!row||!file||!meta||!nyaa)return null;" +
      "const rr=row.getBoundingClientRect(),fr=file.getBoundingClientRect(),mr=meta.getBoundingClientRect();" +
      "const cells=[...meta.children],tops=cells.map(x=>Math.round(x.getBoundingClientRect().top));" +
      "return {rows:root.querySelectorAll('[data-example-row]').length,fileFull:Math.abs(fr.width-rr.width)<=2," +
      "fileAbove:fr.bottom<=mr.top,cells:cells.length,sameRow:tops.length===8&&Math.max(...tops)-Math.min(...tops)<=2," +
      "labels:cells.map(x=>x.querySelector('label')?.textContent.trim()||'')," +
      "versionInputs:[...root.querySelectorAll('input')].filter(x=>x.placeholder==='版本').length," +
      "nyaaInContent:content?content.contains(nyaa):false}})()"
  )
  check(
    '三个示例的文件名输入框各自独占一整行',
    examplesLayout && examplesLayout.rows === 3 && examplesLayout.fileFull && examplesLayout.fileAbove,
    JSON.stringify(examplesLayout)
  )
  check(
    '字幕语言到片源共八项统一排在输入框下方一行',
    examplesLayout && examplesLayout.cells === 8 && examplesLayout.sameRow &&
      ['字幕语言','字幕类型','格式','分辨率','编码','位深','音频编码','片源'].every(
        (label) => examplesLayout.labels.includes(label)
      ),
    JSON.stringify(examplesLayout)
  )
  check(
    '种子名示例没有版本输入框，展开后 Nyaa 也不进入折叠内容',
    examplesLayout && examplesLayout.versionInputs === 0 && !examplesLayout.nyaaInContent,
    JSON.stringify(examplesLayout)
  )

  check(
    '种子名示例检查后恢复收起状态',
    await clickElementAt(win, "document.querySelector('[data-probe=filename-examples-trigger]')")
  )
  await waitFor(win, "document.querySelector('[data-probe=filename-examples-trigger]')?.getAttribute('data-state')==='closed'")

  // ---------- 新建的番剧模板：标题模板 / 简介都是空白 ----------
  // 以前会预填「第一条全局模板」，看着像已经配好了，发布时才发现套的是别的番的模板
  const fresh = await js(
    win,
    `(()=>{const ta=document.querySelector('main textarea.font-mono')
      const ed=document.querySelector('main .md-editor textarea, main .md-editor .cm-content')
      return {tpl: ta?ta.value:null, desc: ed?(ed.value!==undefined?ed.value:ed.textContent):null}})()`
  )
  check('新建番剧模板的标题模板为空白', fresh && fresh.tpl === '', JSON.stringify(fresh))
  check('新建番剧模板的简介为空白', fresh && (fresh.desc === '' || fresh.desc === null), JSON.stringify(fresh))

  // ---------- 番剧模板里可以套用全局标题模板，改过就是「自定义」 ----------
  const pickers = await js(
    win,
    `(()=>{const t=[...document.querySelectorAll('main button[role=combobox]')]
      return t.map(b=>b.textContent.replace(/\\s+/g,' ').trim())})()`
  )
  check(
    '番剧模板页有「套用标题模板 / 套用简介模板」下拉',
    Array.isArray(pickers) &&
      pickers.some((x) => x.includes('套用标题模板')) &&
      pickers.some((x) => x.includes('套用简介模板')),
    JSON.stringify(pickers)
  )
  // 点开标题模板下拉，选第一条全局模板
  check('打开「套用标题模板」下拉', await openSelectByText(win, '套用标题模板'))
  await wait(700)
  check(
    '下拉里列出了全局标题模板',
    await js(win, `[...document.querySelectorAll('[role=option]')].some(o=>o.textContent.includes('默认标题'))`)
  )
  check(
    '选中全局标题模板',
    await clickElementAt(
      win,
      `[...document.querySelectorAll('[role=option]')].find(x=>x.textContent.includes('默认标题'))`
    )
  )
  await wait(900)
  const applied = await js(win, `(()=>{const ta=document.querySelector('main textarea.font-mono'); return ta?ta.value:null})()`)
  check('套用后标题模板被填入内容', applied && applied.includes('{{groupName}}'), `value=${String(applied).slice(0, 40)}`)

  // ---------- 番剧模板的标题模板：输入框上方有实时预览 ----------
  // 预览必须在 textarea **上方**（改模板时眼睛不用来回跳），且已经把变量渲染掉
  const preview = await js(
    win,
    `(()=>{const ta=document.querySelector('main textarea.font-mono'); if(!ta) return null
      const card=ta.closest('div'); if(!card) return null
      const boxes=[...card.querySelectorAll('div.bg-muted\\\\/50')]
      if(!boxes.length) return {found:false}
      const box=boxes[0]
      return {found:true, text:box.textContent.replace(/\\s+/g,' ').trim(),
        above: box.compareDocumentPosition(ta) & Node.DOCUMENT_POSITION_FOLLOWING ? true : false}})()`
  )
  check('标题模板上方有预览框', preview && preview.found, JSON.stringify(preview))
  check('预览框在输入框上方', preview && preview.above === true, JSON.stringify(preview))
  check(
    '预览已渲染变量（不再出现 {{…}}）',
    preview && preview.text && !preview.text.includes('{{'),
    preview && `text=${String(preview.text).slice(0, 60)}`
  )
  check(
    '预览用的是该番剧自己的数据（bgmId 400602 的模板，标题为空时至少渲染出示例集数/分辨率）',
    preview && preview.text.includes('1080P'),
    preview && `text=${String(preview.text).slice(0, 60)}`
  )
  const pickerLabel = await js(
    win,
    `(()=>{const b=[...document.querySelectorAll('main button[role=combobox]')]
      .find(x=>x.textContent.includes('默认标题')||x.textContent.includes('自定义'))
      return b?b.textContent.replace(/\\s+/g,' ').trim():null})()`
  )
  check('套用后下拉显示该模板名', pickerLabel && pickerLabel.includes('默认标题'), `label=${pickerLabel}`)
  // 在模板末尾敲一个字符 → 内容不再和全局模板一致 → 应自动变成「自定义」
  await js(
    win,
    `(()=>{const ta=document.querySelector('main textarea.font-mono'); if(!ta) return false
      ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); return true})()`
  )
  await typeText(win, 'X')
  await wait(700)
  const afterEdit = await js(
    win,
    `(()=>{const b=[...document.querySelectorAll('main button[role=combobox]')]
      .find(x=>x.textContent.includes('默认标题')||x.textContent.includes('自定义'))
      return b?b.textContent.replace(/\\s+/g,' ').trim():null})()`
  )
  check('改动模板内容后自动变成「自定义」', afterEdit === '自定义', `label=${afterEdit}`)

  // ---------- 左侧列表：可拖拽 + 右键菜单 ----------
  check('左侧模板项可拖拽排序', (await js(win, `document.querySelectorAll('[draggable=true]').length`)) >= 1)
  const ctxMenu = await js(
    win,
    `(()=>{ try{
      const el=document.querySelector('main [draggable=true]'); if(!el) return 'no-item'
      el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:60,clientY:120}))
      return 'fired'
    }catch(e){ return String(e) } })()`
  )
  check('对模板项发出右键事件', ctxMenu === 'fired', String(ctxMenu))
  await wait(700)
  const menuItems = await js(
    win,
    `[...document.querySelectorAll('[role=menuitem]')].map(e=>e.textContent.replace(/\\s+/g,' ').trim())`
  )
  check(
    '右键菜单有「重命名」和「删除」',
    Array.isArray(menuItems) && menuItems.some((x) => x.includes('重命名')) && menuItems.some((x) => x.includes('删除')),
    JSON.stringify(menuItems)
  )
  await pressKey(win, 'Escape')
  await wait(400)

  // ---------- 下拉框是应用内的，不是系统原生 ----------
  // 原生 <select> 弹出的是操作系统列表：直角、系统配色、没有动画，且不跟主题走
  check('页面里没有原生 <select>', (await js(win, `document.querySelectorAll('select').length`)) === 0)
  const groupSel = await js(
    win,
    `(()=>{const t=[...document.querySelectorAll('main button[role=combobox]')];
      return {count:t.length, radius:t[0]?getComputedStyle(t[0]).borderTopLeftRadius:null}})()`
  )
  check('发布组用的是 reka-ui 下拉（role=combobox）', groupSel && groupSel.count >= 1, JSON.stringify(groupSel))
  check(
    '下拉触发器是圆角（不是系统直角控件）',
    groupSel && groupSel.radius && parseFloat(groupSel.radius) > 0,
    groupSel && `radius=${groupSel.radius}`
  )

  // ---------- 动效：Tailwind v4 下 animate-* 必须真的生成了 CSS ----------
  // v3 的 tailwindcss-animate 那套 class（animate-in / fade-in-0 / zoom-in-95）在 v4 里
  // 不生成任何规则，写了等于没写 —— 这里直接问浏览器要计算样式，确认动画真的挂上了
  const anim = await js(
    win,
    `(()=>{const el=document.createElement('div');
      el.className='data-[state=open]:animate-fade-in'; el.setAttribute('data-state','open');
      document.body.appendChild(el);
      const s=getComputedStyle(el); const out={name:s.animationName, dur:s.animationDuration};
      el.remove(); return out})()`
  )
  check('animate-* 工具类真的生成了 CSS', anim && anim.name === 'fade-in' && anim.dur !== '0s', JSON.stringify(anim))
  const kf = await js(
    win,
    `(()=>{const names=new Set();
      for(const ss of document.styleSheets){ try{ for(const r of ss.cssRules){ if(r.type===CSSRule.KEYFRAMES_RULE) names.add(r.name) } }catch{} }
      return ['fade-in','fade-out','pop-in','pop-out','slide-up','slide-down','collapsible-down','collapsible-up'].filter(n=>!names.has(n))})()`
  )
  check('八个关键帧全部注册', Array.isArray(kf) && kf.length === 0, `缺: ${JSON.stringify(kf)}`)

  // ---------- md-editor：行号槽 + 不横向溢出 ----------
  const hasEditor = await waitFor(win, `document.querySelector('.md-editor .cm-content')`)
  check('番剧模板页有 Markdown 编辑器', hasEditor)
  check('Markdown 编辑器有行号槽', hasEditor && (await js(win, `!!document.querySelector('.md-editor .cm-gutters')`)))
  const overflow = await js(
    win,
    `(()=>{const e=document.querySelector('.md-editor'); const m=document.querySelector('main');
      return {ed:e?e.scrollWidth-e.clientWidth:null, main:m?m.scrollWidth-m.clientWidth:null}})()`
  )
  check(
    '编辑器与主区无横向溢出',
    overflow && overflow.ed !== null && overflow.ed <= 1 && overflow.main <= 1,
    JSON.stringify(overflow)
  )
  check('番剧简介异步编辑器可以输入并实时预览', await editMarkdown(win, 'ABP anime roundtrip'))
  check('番剧简介的异步 v-model 已保存', await waitFor(win,
    `window.api.loadStore().then(data => data.animeTemplates.some(t => t.descriptionMd.includes('ABP anime roundtrip')))`))
  const editorTheme = await js(win, `(()=>{
    const e=document.querySelector('.md-editor'); const reference=document.createElement('div')
    reference.style.backgroundColor='var(--card)'; document.body.append(reference)
    const matches=getComputedStyle(e).backgroundColor===getComputedStyle(reference).backgroundColor
    reference.remove(); return matches
  })()`)
  check('异步加载的编辑器样式仍跟随应用主题', editorTheme)

  // ---------- 确认弹窗是应用内的，且关掉之后输入框还能打字 ----------
  // 这是本轮最重要的回归：window.confirm 是系统模态框，关掉之后键盘焦点回不到 webContents，
  // 之后所有输入框都「能删、打不进去」。现在换成 reka-ui AlertDialog。
  // 注意顺序：这一段结尾会把模板删掉，凡是依赖「有选中模板」的断言都得排在它前面。
  check('没有残留 window.confirm 调用', !bundleUsesNativeConfirm())
  const deleteClicked = await clickByText(win, '删除', { root: 'main' })
  check('点击番剧模板的「删除」', deleteClicked)
  await wait(700)
  const dlg = await js(
    win,
    `(()=>{const el=document.querySelector('[role=alertdialog]');
      if(!el) return {present:false}
      const r=el.getBoundingClientRect()
      return {present:true,
        // 首帧就该在中间：Tailwind v4 的 -translate-x-1/2 编译成独立的 translate 属性，
        // 关键帧里再写 transform: translate(-50%,-50%) 会叠加成 -100%，弹窗先闪现在左上角
        cx:Math.round(r.left+r.width/2), cy:Math.round(r.top+r.height/2),
        vw:window.innerWidth, vh:window.innerHeight}})()`
  )
  check('弹出的是应用内 AlertDialog（非系统弹窗）', dlg && dlg.present, JSON.stringify(dlg))
  check(
    '弹窗一出现就在正中（不会从左上角闪过去）',
    dlg && dlg.present && Math.abs(dlg.cx - dlg.vw / 2) < 24 && Math.abs(dlg.cy - dlg.vh / 2) < 24,
    JSON.stringify(dlg)
  )
  check('取消确认弹窗', await clickByText(win, '取消', { root: 'body', last: true }))
  check('弹窗已关闭', await waitFor(win, `!document.querySelector('[role=alertdialog]')`))
  // 关键：弹窗关掉之后输入框必须还能接受键入
  const afterDlg = await focusByPlaceholder(win, '400602', { select: true })
  check('确认弹窗关闭后输入框仍可聚焦', afterDlg !== null)
  if (afterDlg !== null) {
    await typeText(win, '12345')
    const typedAfter = await valueByPlaceholder(win, '400602')
    check('确认弹窗关闭后仍能打字（曾被 window.confirm 锁死）', typedAfter === '12345', `value=${typedAfter}`)
  }

  // ---------- 点「确认」必须真的删掉 ----------
  // 上一版用 AlertDialogAction 包按钮，它自带的关闭处理会先触发 onOpenChange(false)，
  // 把 Promise 抢先结算成 false —— 点了确认删除却没反应。只测「取消」是测不出来的。
  const beforeDel = await js(win, `document.querySelectorAll('[draggable=true]').length`)
  check('删除前列表有模板', beforeDel >= 1, `count=${beforeDel}`)
  check('再次点击「删除」', await clickByText(win, '删除', { root: 'main' }))
  await wait(700)
  check('确认删除', await clickByText(win, '确认', { root: 'body', exact: true, last: true }))
  await wait(900)
  const listAfter = await js(win, `document.querySelectorAll('[draggable=true]').length`)
  check('点确认之后模板真的被删掉了', listAfter === beforeDel - 1, `${beforeDel} → ${listAfter}`)

  // ---------- 代理端口：可以删空、可以自由输入 ----------
  await nav(win, 4)
  await wait(700)
  check('进入代理设置', await clickByText(win, '代理'))
  await wait(500)
  check('切到自定义代理', await clickByText(win, '自定义', { exact: true }))
  await wait(600)
  const portFocused = (await focusByPlaceholder(win, '7890', { select: true })) !== null
  check('找到代理端口输入框', portFocused)
  if (portFocused) {
    await pressKey(win, 'Backspace')
    const cleared = await valueByPlaceholder(win, '7890')
    check('代理端口可以清空（不再被回灌旧值）', cleared === '', `value="${cleared}"`)
    await typeText(win, '1080')
    const typed = await valueByPlaceholder(win, '7890')
    check('代理端口可以正常输入', typed === '1080', `value=${typed}`)
  }

  // ---------- 落盘：API Key 不进 config.json ----------
  await nav(win, 2)
  await wait(600)
  check('打开「创建组」', await clickByText(win, '创建组'))
  await wait(900)
  check('聚焦组名输入框', (await focusByPlaceholder(win, '三明治摆烂组')) !== null)
  await typeText(win, 'probegroup')
  check('提交建组', await clickByText(win, '添加', { exact: true, last: true, root: 'body' }))
  await wait(900)
  const keyFocused = await js(
    win,
    `(()=>{const el=document.querySelector('input[type=password]'); if(!el) return false; el.focus(); return true})()`
  )
  check('聚焦 API Key 输入框', keyFocused)
  await typeText(win, 'abp_secret_probe_key')
  await wait(1600)

  const cfgPath = path.join(sandbox, 'AniBT Publish', 'config.json')
  const secPath = path.join(sandbox, 'AniBT Publish', 'secrets.json')
  const cfgRaw = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf-8') : ''
  check('config.json 已写出', cfgRaw.length > 0)
  check('secrets.json 已写出', fs.existsSync(secPath))
  check('config.json 里没有 API Key 明文', cfgRaw.length > 0 && !cfgRaw.includes('abp_secret_probe_key'))
  if (fs.existsSync(secPath)) {
    const sec = fs.readFileSync(secPath, 'utf-8')
    check('secrets.json 里也没有明文（已加密）', !sec.includes('abp_secret_probe_key'))
    let env = null
    try {
      env = JSON.parse(sec)
    } catch {
      /* 下面的断言会报出来 */
    }
    check('secrets.json 是 aes-256-gcm 信封', env && env.alg === 'aes-256-gcm', env && JSON.stringify(Object.keys(env)))
  }

  // ---------- 发布流程：Preview 开关要活过路由切换 ----------
  // 「开了 Preview，去别的页面转一圈回来，开关自己关了」—— 因为它原先是底栏组件里的
  // 局部 ref，切页面把组件卸载掉就归零了。现在存在 store 里。
  // 这一段顺便把队列真的走到阶段二，是唯一能碰到底栏的路径。
  await nav(win, 1)
  await wait(900)
  check('回到番剧模板 tab', await clickByText(win, '番剧模板', { exact: true }))
  await wait(700)
  check('新建一个番剧模板（发布流程要用）', await clickByText(win, '添加番剧模板'))
  await wait(900)
  check('填 bgmId', (await focusByPlaceholder(win, '手动输入')) !== null)
  await typeText(win, '400602')
  check('提交新建', await clickByText(win, '添加', { exact: true, last: true, root: 'body' }))
  await wait(1400)
  // 选发布组（前面建的 probegroup），否则发布会在「发布组未配置 API Key」就短路
  check('打开发布组下拉', await openSelectByText(win, '必须选择发布组'))
  await wait(700)
  check(
    '选中 probegroup',
    await clickElementAt(win, `[...document.querySelectorAll('[role=option]')].find(x=>x.textContent.includes('probegroup'))`)
  )
  await wait(700)

  // 回发布页，用合成 drop 事件塞一个种子进去（走的是真实的 addTorrentBytes 通道）
  await nav(win, 0)
  await wait(800)
  const dropped = await js(
    win,
    `(()=>{ try{
      const enc=new TextEncoder()
      const announce='http://nyaa.tracker.wf:7777/announce'
      const name='[probe] Anime - 08 [CHI_JPN][WebRip HEVC 10bit 1080P AAC].mkv'
      const bytes=enc.encode('d8:announce'+announce.length+':'+announce+'4:infod6:lengthi1024e4:name'+enc.encode(name).length+':'+name+'ee')
      const file=new File([bytes], 'probe.torrent', {type:'application/x-bittorrent'})
      const dt=new DataTransfer(); dt.items.add(file)
      const zone=document.querySelector('main button.border-dashed'); if(!zone) return 'no-zone'
      zone.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}))
      return 'dropped'
    }catch(e){ return String(e) } })()`
  )
  check('拖放一个种子到投放区', dropped === 'dropped', String(dropped))
  await wait(1800)
  check('队列里出现条目', (await js(win, `document.querySelectorAll('main .border.bg-card').length`)) >= 1)
  // 识别结果：CHI_JPN 应当是简+繁+日（这条链路端到端验证第 5 项的词库改动）
  const detected = await js(
    win,
    `[...document.querySelectorAll('main .border.bg-card span.inline-flex')].map(e=>e.textContent.trim())`
  )
  check(
    '拖进来的种子识别出 CHS/CHT/JP（CHI_JPN 端到端）',
    Array.isArray(detected) && ['CHS', 'CHT', 'JP'].every((l) => detected.includes(l)),
    JSON.stringify(detected)
  )
  // 选番剧模板 → 下一步
  check('打开条目的番剧模板下拉', await openSelectByText(win, '选择模板'))
  await wait(700)
  check(
    '给条目选中番剧模板',
    await clickElementAt(win, `document.querySelectorAll('[role=option]')[0]`)
  )
  await wait(800)
  check('点「下一步」进入阶段二', await clickByText(win, '下一步', { root: 'body' }))
  await wait(1000)

  // ---------- 空标题必须在本地就被拦住 ----------
  // 新建的番剧模板标题模板是空的，渲染出来的标题就是空串。
  // 以前会照发不误，站点回一句 422「Invalid request body」，不说是哪个字段 ——
  // 用户只看到一个红叉。现在：输入框标红 + 发布按钮按住。
  const emptyTitle = await js(
    win,
    `(()=>{const i=document.querySelector('main input'); if(!i) return null
      return {value:i.value, flagged:i.className.includes('border-destructive')}})()`
  )
  check('新建模板渲染出来的标题确实是空的', emptyTitle && emptyTitle.value === '', JSON.stringify(emptyTitle))
  check('空标题的输入框被标红', emptyTitle && emptyTitle.flagged === true, JSON.stringify(emptyTitle))
  const pubBtn = await js(
    win,
    `(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^发布 \\(/.test(x.textContent.trim()))
      return b?{disabled:b.disabled}:null})()`
  )
  check('标题为空时发布按钮是禁用的', pubBtn && pubBtn.disabled === true, JSON.stringify(pubBtn))

  // 填上标题，按钮应当恢复
  await js(win, `(()=>{const i=document.querySelector('main input'); i.focus(); i.select()})()`)
  await typeText(win, '[probe] Anime - 08 [1080p].mkv')
  await wait(700)
  const pubBtn2 = await js(
    win,
    `(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^发布 \\(/.test(x.textContent.trim()))
      return b?{disabled:b.disabled}:null})()`
  )
  check('填上标题后发布按钮恢复可用', pubBtn2 && pubBtn2.disabled === false, JSON.stringify(pubBtn2))

  check('展开发布行的简介编辑器', await clickElementAt(win, `document.querySelector('main button[title="展开"]')`))
  check('发布行异步编辑器可以输入并实时预览', await editMarkdown(win, 'ABP publish roundtrip'))
  await nav(win, 4)
  await waitFor(win, `!document.querySelector('.md-editor')`)
  await nav(win, 0)
  check('发布简介在切换页面后保留', await waitFor(win,
    `document.querySelector('.md-editor .cm-content')?.textContent.includes('ABP publish roundtrip')`))
  await clickElementAt(win, `document.querySelector('main button[title="展开"]')`)
  check('收起发布行会销毁编辑器实例', await waitFor(win, `!document.querySelector('.md-editor')`))

  // 打开 Preview 开关
  const previewSwitch = `[...document.querySelectorAll('button[role=switch]')].find(b=>b.closest('label')&&b.closest('label').textContent.includes('Preview'))`
  check('找到 Preview 测试发布开关', await waitFor(win, previewSwitch))
  check('打开 Preview 开关', await clickElementAt(win, previewSwitch))
  check(
    'Preview 开关已打开',
    await waitFor(win, `(${previewSwitch})?.getAttribute('data-state')==='checked'`),
    `state=${await js(win, `(()=>{const b=${previewSwitch}; return b?b.getAttribute('data-state'):null})()`)}`
  )
  // 切走再切回来 —— 这正是用户报告的复现路径
  await nav(win, 4)
  await waitFor(win, `!document.querySelector('button[role=switch]')`)
  await nav(win, 0)
  check(
    '切换页面再回来，Preview 开关仍然是开的',
    await waitFor(win, `(${previewSwitch})?.getAttribute('data-state')==='checked'`),
    `state=${await js(win, `(()=>{const b=${previewSwitch}; return b?b.getAttribute('data-state'):null})()`)}`
  )

  // ---------- 发布链路的克隆安全 ----------
  // entry.languages 是 store 里的响应式数组（Proxy），以前直接送进 IPC 会抛
  // 「An object could not be cloned.」—— preview 和正式发布都中招。
  //
  // 这里**不**点发布：探针不该拿种子和 API Key 去戳线上站点，而克隆发生在
  // contextBridge 边界上、网络请求之前，点了也只是白发一个请求。
  // 机制本身由单测覆盖（scripts/run-checks.mjs 的 `plain (IPC 序列化)` 段，
  // 用真的 Vue reactive 断言「裸的会抛、toPlain 过的不会」）。
  // 真窗口这边只确认构建产物里还留着那道防线 —— 免得有人手滑把 toPlain 删了。
  check(
    '发布 payload 仍然经过 toPlain（构建产物里能找到）',
    bundleHasPlainGuard(),
    '出站 payload 必须先 toPlain，否则响应式数组会炸结构化克隆'
  )

  // ---------- 控制台零错误 ----------
  check('渲染进程控制台零错误', errors.length === 0, errors.slice(0, 3).join(' | '))
}

// 看门狗：任何一步卡住也别让 GUI 进程永久挂着（会占着单实例锁）
const watchdog = setTimeout(() => {
  console.error('探针超时（300s），强制退出')
  app.exit(1)
}, 300_000)

app.whenReady().then(async () => {
  await wait(2500)
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) {
    console.error('探针失败：拿不到窗口（可能被单实例锁挡住了，先杀掉残留的 electron 进程）')
    return app.exit(1)
  }
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 3) errors.push(String(e.message).slice(0, 300))
  })
  win.setSize(1280, 860)
  // Real pointer events need focus; background throttling can stall closing overlays.
  win.webContents.setBackgroundThrottling(false)
  win.show()
  win.focus()
  win.webContents.focus()

  try {
    check('Probe window has input focus', await waitFor(win, 'document.hasFocus()'))
    await run(win)
  } catch (err) {
    check(`探针自身出错：${String(err).slice(0, 200)}`, false)
  }

  clearTimeout(watchdog)
  const failed = results.filter((r) => !r.pass)
  for (const r of results) {
    console.log(`  ${r.pass ? '✓' : '✗'} ${r.name}${r.pass || !r.detail ? '' : `  → ${r.detail}`}`)
  }
  console.log(`\n${results.length - failed.length}/${results.length} 通过`)
  try {
    fs.rmSync(sandbox, { recursive: true, force: true })
  } catch {
    /* 临时目录留着也无妨 */
  }
  app.exit(failed.length === 0 ? 0 : 1)
})
