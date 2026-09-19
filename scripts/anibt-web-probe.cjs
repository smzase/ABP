// Offline AniBT fixture: no real credentials, auth requests or CAPTCHA service are used.
const { BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const isolated = new WeakSet()
let webSession
let rejectLogin = false
let loginPosts = 0
let sessionReads = 0
let groupLoads = 0
let signInLoads = 0

const loginHtml = `<!doctype html><html><head><meta name="theme-color" content="#fffbfc"></head><body>
<form><input name="email" type="email"><input name="password" type="password">
<cap-widget><button type="button" id="human">我是人类（离线测试）</button></cap-widget>
<button type="submit" data-testid="sign-in-submit">登录</button></form><div data-sonner-toaster><p id="error"></p></div>
<script>
customElements.define('cap-widget',class extends HTMLElement{});
window.$_TSR={hydrated:true};window.formState={email:'',password:''};window.challenge=false;
// Emulate React's value tracker: direct input.value=... would leave formState unchanged.
const native=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
for(const input of document.querySelectorAll('input')){
 let tracked='';Object.defineProperty(input,'value',{get(){return native.get.call(this)},set(v){tracked=v;native.set.call(this,v)}});
 input.addEventListener('input',()=>{if(input.value!==tracked){tracked=input.value;window.formState[input.name]=input.value}});
}
document.querySelector('cap-widget').addEventListener('solve',()=>window.challenge=true);
document.querySelector('#human').onclick=()=>document.querySelector('cap-widget').dispatchEvent(new CustomEvent('solve',{detail:{token:'offline-only'}}));
document.querySelector('form').onsubmit=async e=>{e.preventDefault();if(!window.challenge)return;
 const r=await fetch('/api/auth/sign-in/email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(window.formState)});
 if(r.ok)location.href='/groups';else document.querySelector('#error').textContent='邮箱或密码错误';};
</script></body></html>`
const groupsHtml = '<!doctype html><html><head><meta name="theme-color"></head><body><h1>字幕组仪表盘（离线测试）</h1><input id="draft"><a href="https://example.invalid/">外部链接</a></body></html>'

function isolateSession(ses) {
  if (isolated.has(ses)) return
  isolated.add(ses)
  const isWeb = path.basename(ses.storagePath || '') === 'abp-anibt-web'
  const isBgmFixture = raw => { const url = new URL(raw); return url.origin === 'https://anibt.net' && url.pathname === '/api/bgm/search' && url.searchParams.get('q') === '_probe_bgm_' }
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    callback({ cancel: !(isWeb && new URL(details.url).origin === 'https://anibt.net') && !(!isWeb && isBgmFixture(details.url)) })
  })
  if (!isWeb) {
    ses.protocol.handle('https', request => isBgmFixture(request.url)
      ? Response.json({ ok: true, data: [{ bgmId: 777001, name: 'Offline Anime', nameCn: '离线候选番剧' }] })
      : new Response('Blocked', { status: 403 }))
    return
  }
  webSession = ses
  ses.protocol.handle('https', async request => {
    const url = new URL(request.url)
    if (url.origin !== 'https://anibt.net') return new Response('Blocked', { status: 403 })
    const authenticated = (await ses.cookies.get({ name: 'offline-session' })).some(c => c.value === 'verified')
    if (url.pathname === '/api/auth/get-session') {
      sessionReads++
      return Response.json(authenticated ? { user: { id: 'offline-user' }, session: { id: 'offline-session' } } : null)
    }
    if (url.pathname === '/api/auth/sign-in/email') {
      loginPosts++
      const body = await request.json()
      if (rejectLogin || body.email !== 'probe@example.invalid' || body.password !== 'web-probe-password') return new Response('Invalid', { status: 401 })
      await ses.cookies.set({ url: 'https://anibt.net', name: 'offline-session', value: 'verified', secure: true, httpOnly: true })
      return Response.json({ ok: true })
    }
    if (url.pathname === '/api/auth/sign-out') {
      await ses.cookies.remove('https://anibt.net', 'offline-session')
      return Response.json({ success: true })
    }
    if (url.pathname === '/groups') {
      groupLoads++
      if (!authenticated) return new Response('', { status: 302, headers: { Location: 'https://anibt.net/auth/sign-in?redirectTo=%2Fgroups' } })
      const locale = (await ses.cookies.get({ name: 'PARAGLIDE_LOCALE' }))[0]?.value || 'zh'
      const label = { zh: '字幕组仪表盘（离线测试）', 'zh-Hant': '字幕組儀表板（離線測試）', en: 'Group dashboard (offline)' }[locale]
      return new Response(groupsHtml.replace('<html>', `<html lang="${locale}">`).replace('字幕组仪表盘（离线测试）', label), { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }
    if (url.pathname === '/auth/sign-in') {
      signInLoads++
      if (authenticated) throw new Error('Simulated already-authenticated sign-in navigation failure')
      return new Response(loginHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }
    return new Response('', { status: 404 })
  })
}

async function until(fn, timeout = 8000) {
  const end = Date.now() + timeout
  do {
    const result = await fn()
    if (result) return result
    await new Promise(resolve => setTimeout(resolve, 80))
  } while (Date.now() < end)
  return null
}

async function run({ win, js, check, waitFor, clickElementAt, typeText, nav, sandbox }) {
  const click = selector => {
    win.webContents.focus()
    return clickElementAt(win, `document.querySelector(${JSON.stringify(selector)})`)
  }
  const nativeView = () => win.contentView.children.find(v => v.webContents?.getURL().startsWith('https://anibt.net/'))
  const popup = () => BrowserWindow.getAllWindows().find(w => w.id !== win.id)
  const challengeView = () => win.contentView.children.find(v => v.webContents?.getURL().includes('/auth/sign-in') && v.getVisible())
  const menuView = () => win.contentView.children.find(v => v.webContents?.getURL().includes('/dashboard-menu.html'))
  const menuOnTop = () => menuView()?.getVisible() && nativeView()?.getVisible() &&
    win.contentView.children.indexOf(menuView()) > win.contentView.children.indexOf(nativeView())
  const clickMenu = selector => {
    menuView().webContents.focus()
    return clickElementAt(menuView(), `document.querySelector(${JSON.stringify(selector)})`)
  }
  const hoverSelector = async selector => {
    const rect = await js(win, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`)
    if (!rect) return false
    win.webContents.sendInputEvent({ type: 'mouseMove', ...rect })
    return !!(await until(async () => menuOnTop() && await js(menuView(), "!!document.querySelector('[role=tooltip]')")))
  }
  let lastPagePixel
  const pageColor = expected => until(async () => {
    try {
      const frame = await nativeView().webContents.capturePage()
      lastPagePixel = [...frame.toBitmap().subarray(0, 4)].join(',')
      return !frame.isEmpty() && lastPagePixel === expected
    } catch { return false } // Compositor may still be submitting the first frame.
  })
  await click('[data-probe=anibt-web-account]')
  check('独立网页账号页无需创建发布组', await waitFor(win, `document.querySelector('#anibt-web-email')`))
  check('空网页账号无法点击登录', await js(win, `document.querySelector('[data-probe=web-login]').disabled`))
  await click('[data-probe=web-check]')
  check('未登录检查显示真实未登录状态，不报 Redirect was cancelled', await waitFor(win,
    `(()=>{const t=document.querySelector('[role=status]')?.textContent||'';return t.includes('尚未登录')&&!t.includes('Redirect was cancelled')})()`))
  await click('#anibt-web-email')
  await typeText(win, 'probe@example.invalid')
  await click('#anibt-web-password')
  await typeText(win, 'web-probe-password')
  await click('[data-probe=web-login]')
  let login = await until(challengeView)
  if (!login) throw new Error('Inline verification was not created')
  check('人机验证内嵌账号页，不创建独立窗口', !popup() && await js(win, "!!document.querySelector('[data-probe=web-challenge-host]')"))
  check('内嵌区域只显示验证码，保留真实站点表单且不暴露 IPC', await js(login,
    "getComputedStyle(document.querySelector('input[name=email]')).display==='none' && document.querySelector('#human').getBoundingClientRect().height>0 && typeof window.api==='undefined'"))
  check('验证码宿主有可绘制尺寸，不会折叠为空白', await js(login,
    "(()=>{const r=document.querySelector('cap-widget').getBoundingClientRect();return r.width>=280&&r.height>=60})()"))
  check('验证码区域紧贴组件，未保留大片空白', await js(win,
    "(()=>{const r=document.querySelector('[data-probe=web-challenge-host]').getBoundingClientRect();return r.width<=324&&r.height===88})()"))
  check('网页登录按受控表单事件填写邮箱密码', await waitFor(login,
    `window.formState?.email==='probe@example.invalid' && window.formState?.password==='web-probe-password'`))
  // Clearance alone must not be accepted as login. Close before any form submission.
  await webSession.cookies.set({ url: 'https://anibt.net', name: 'captcha-clearance', value: 'only-human' })
  await click('[data-probe=web-login-cancel]')
  check('取消内嵌验证不会伪报成功或重定向取消', await waitFor(win,
    `!document.querySelector('[data-probe=web-login]').disabled && document.querySelector('[role=status]')?.textContent.includes('已取消登录')`) && !challengeView())
  check('验证码通过前不会提交登录', loginPosts === 0)

  await click('[data-probe=web-login]')
  const abandonedContents = (await until(challengeView))?.webContents
  await nav(win, 0)
  check('离开账号页销毁验证码视图，未完成验证不会提交', !!(await until(() => abandonedContents?.isDestroyed() && !challengeView() && !popup())) && loginPosts === 0)
  await click('[data-probe=anibt-web-account]')
  check('返回账号页后可以重新登录', await waitFor(win, "!document.querySelector('[data-probe=web-login]').disabled"))

  rejectLogin = true
  await click('[data-probe=web-login]')
  login = await until(challengeView)
  if (!login) throw new Error('Retry verification was not created')
  await waitFor(login, `window.formState?.password==='web-probe-password'`)
  login.webContents.focus()
  await clickElementAt(login, `document.querySelector('#human')`)
  check('错误凭据在内嵌区域展示网站错误并可重试', await waitFor(login, `document.querySelector('#error')?.textContent.includes('邮箱或密码错误') && document.querySelector('#error').getBoundingClientRect().height>0`))
  check('错误提示按需撑开高度且不遮挡验证码', await waitFor(login,
    "(()=>{const e=document.querySelector('#human'),r=e.getBoundingClientRect(),error=document.querySelector('#error').getBoundingClientRect();return error.top>=document.querySelector('cap-widget').getBoundingClientRect().bottom&&error.bottom<=innerHeight&&document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===e})()"))
  await js(login, "document.querySelector('#error').textContent=''")
  check('错误提示消失后恢复紧凑高度', await waitFor(win,
    "document.querySelector('[data-probe=web-challenge-host]').getBoundingClientRect().height===88"))
  rejectLogin = false
  await clickElementAt(login, `document.querySelector('#human')`)
  check('完成人机验证后提交表单，验证真实会话再移除验证区', !!(await until(() => !challengeView())) && await waitFor(win,
    `document.querySelector('[role=status]')?.textContent.includes('网页已登录')`), JSON.stringify({ loginPosts, sessionReads, challenge: !!challengeView() }))
  check('登录结果使用会话接口验证', sessionReads >= 3 && loginPosts === 2, JSON.stringify({ loginPosts, sessionReads }))
  const previousSignInLoads = signInLoads
  await click('[data-probe=web-login]')
  check('已登录再次点登录直接验证会话，不打开登录页或报 ERR_FAILED', await waitFor(win,
    "!document.querySelector('[data-probe=web-login]').disabled && document.querySelector('[role=status]')?.textContent.includes('网页已登录')") && signInLoads === previousSignInLoads && !challengeView() && !popup())

  await click('[data-probe=anibt-dashboard]')
  check('仪表盘标题栏显示账号与刷新按钮且页面不重复显示标题', await waitFor(win,
    `document.querySelector('[data-probe=titlebar-anibt-account]')?.textContent.includes('AniBT账号') && document.querySelector('[data-probe=titlebar-dashboard-refresh]')?.textContent.includes('刷新') && !document.querySelector('[data-probe=dashboard-page]')?.textContent.includes('字幕组仪表盘')`))
  check('仪表盘成为主窗口子视图，不创建弹窗', !!(await until(() => nativeView()?.getVisible())) && BrowserWindow.getAllWindows().length === 1)
  let view = nativeView()
  if (!view) throw new Error('Embedded dashboard was not attached')
  check('仪表盘复用已登录会话并进入 /groups', view.webContents.getURL() === 'https://anibt.net/groups')
  const beforeRefresh = groupLoads
  await click('[data-probe=titlebar-dashboard-refresh]')
  check('标题栏刷新会重新加载仪表盘网页', await until(() => groupLoads > beforeRefresh))
  const prefs = view.webContents.getLastWebPreferences()
  check('网页不暴露 Node 或客户端 IPC', prefs.sandbox && !prefs.nodeIntegration && prefs.contextIsolation &&
    await view.webContents.executeJavaScript(`typeof window.api==='undefined' && typeof require==='undefined'`))
  check('内嵌页初始主题跟随浅色', await view.webContents.executeJavaScript(`document.documentElement.classList.contains('light')&&localStorage.getItem('theme')==='light'`))
  await view.webContents.executeJavaScript(`document.querySelector('#draft').value='unsaved-draft'`)
  const loads = groupLoads
  const menu = await until(menuView)
  if (!menu) throw new Error('Native menu renderer was not created')
  await js(menu, "window.menuAnimations=[];for(const name of ['animationstart','animationend'])document.addEventListener(name,e=>{if(e.target.classList.contains('native-menu-panel'))window.menuAnimations.push({event:name,name:e.animationName,phase:e.target.dataset.phase})},true)")
  let pageHides = 0
  let menuShows = 0
  let stackingFailures = 0
  const originalPageVisible = view.setVisible.bind(view)
  view.setVisible = visible => { if (!visible) pageHides++; originalPageVisible(visible) }
  const originalMenuVisible = menu.setVisible.bind(menu)
  menu.setVisible = visible => {
    if (visible) {
      menuShows++
      if (win.contentView.children.indexOf(menu) <= win.contentView.children.indexOf(view)) stackingFailures++
    }
    originalMenuVisible(visible)
  }
  await click('aside button[title="外观"]')
  check('外观菜单由上层原生视图显示，网页始终可见', await until(menuOnTop))
  if (!menuOnTop()) throw new Error('Native appearance menu did not become visible above the page')
  check('仪表盘浮窗实际播放入场动画', await waitFor(menu, "window.menuAnimations.some(e=>e.event==='animationend'&&e.name==='slide-up'&&e.phase==='open')"))
  check('菜单仅有受限设置桥接，不读取账号和配置', await js(menu,
    "typeof window.api==='undefined' && typeof window.dashboardMenu.action==='function' && typeof require==='undefined'"))
  check('仪表盘没有网页截图，也没有网页下方的 DOM 弹窗', await js(win,
    "!document.querySelector('[data-probe=dashboard-snapshot]') && !document.querySelector('[data-reka-popper-content-wrapper]')"))
  check('真实浅色网页画面可见', await pageColor('252,251,255,255'))
  await clickMenu('[data-theme=dark]')
  check('菜单不关闭就能切换深色，网页草稿不丢失', await until(async () => menuOnTop() &&
    await js(view, "document.documentElement.classList.contains('dark') && localStorage.getItem('theme')==='dark' && document.querySelector('#draft').value==='unsaved-draft'")))
  check('菜单保持打开时真实网页已经绘制深色', await pageColor('26,16,23,255'))
  check('原生菜单自身也实时切换深色', await waitFor(menu, "document.documentElement.classList.contains('dark')"))
  await js(view, "window.probeFrames=0; window.animateProbe=()=>{window.probeFrames++;requestAnimationFrame(window.animateProbe)};requestAnimationFrame(window.animateProbe)")
  check('菜单打开期间网页持续绘制新帧', await waitFor(view, 'window.probeFrames>=5') && menuOnTop(),
    await js(view, 'JSON.stringify({frames:window.probeFrames,visibility:document.visibilityState})'))
  await clickMenu('[data-theme=light]')
  check('菜单保持打开时真实网页恢复浅色且未刷新', await pageColor('252,251,255,255') && groupLoads === loads && menuOnTop(),
    JSON.stringify({ pixel: lastPagePixel, menuOnTop: menuOnTop(), loads, groupLoads }))
  await click('aside button[title="外观"]')
  check('再次点击外观按钮能关闭菜单', await until(() => !menu.getVisible()))
  check('仪表盘浮窗退场动画结束后才移除视图', await js(menu, "window.menuAnimations.some(e=>e.event==='animationend'&&e.name==='fade-out'&&e.phase==='closed')"))
  await click('aside button[title="外观"]')
  await until(menuOnTop)
  await click('[data-probe=sidebar-language]')
  check('快速从外观切到语言，旧退场不关闭新菜单', await until(menuOnTop) && await waitFor(menu, "!!document.querySelector('[data-locale=en]') && document.querySelector('.native-menu-panel')?.dataset.phase==='open'"))
  await clickMenu('[data-locale=en]')
  check('客户端切换 English 后 AniBT 同步为 en', await waitFor(win, "document.documentElement.lang==='en'") &&
    !!(await until(async () => (await webSession.cookies.get({ name: 'PARAGLIDE_LOCALE' })).some(c => c.value === 'en'))))
  check('语言菜单保持打开时 AniBT 已实际显示英文且保留登录', await until(async () => {
    try { return menuOnTop() && await js(view, "document.documentElement.lang==='en'&&document.querySelector('h1')?.textContent==='Group dashboard (offline)'") } catch { return false }
  }))
  const sameLocaleLoads = groupLoads
  await clickMenu('[data-locale=en]')
  check('重复选择同语言不刷新网页', groupLoads === sameLocaleLoads)
  await clickMenu('[data-locale="zh-TW"]')
  check('语言菜单保持打开时 AniBT 已实际显示繁体中文', await until(async () => {
    try { return menuOnTop() && await js(view, "document.documentElement.lang==='zh-Hant'&&document.querySelector('h1')?.textContent==='字幕組儀表板（離線測試）'") } catch { return false }
  }))
  await clickMenu('[data-locale="zh-CN"]')
  check('语言菜单保持打开时 AniBT 已实际显示简体中文', await until(async () => {
    try { return menuOnTop() && await js(view, "document.documentElement.lang==='zh'&&document.querySelector('h1')?.textContent==='字幕组仪表盘（离线测试）'") } catch { return false }
  }))
  await waitFor(win, "document.documentElement.lang==='zh-CN'")
  // A page reload can change native focus; real key input requires the target focused.
  win.focus()
  menu.webContents.focus()
  await until(() => menu.webContents.isFocused())
  menu.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  menu.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  check('Esc 关闭原生菜单且恢复客户端输入焦点', await until(() => !menu.getVisible() && win.webContents.isFocused()))
  await click('aside button[title="外观"]')
  await until(menuOnTop)
  win.focus()
  view.webContents.focus()
  await clickElementAt(view, "document.querySelector('#draft')")
  check('点击网页能关闭菜单且网页输入仍可使用', await until(() => !menu.getVisible()))
  view.webContents.focus()
  await view.webContents.insertText('after-menu')
  check('原生菜单关闭后网页能正常输入', await waitFor(view, "document.querySelector('#draft').value==='after-menu'"),
    await js(view, "JSON.stringify({value:document.querySelector('#draft').value,active:document.activeElement?.tagName,focus:document.hasFocus(),visibility:document.visibilityState})"))
  menu.webContents.debugger.attach('1.3')
  await menu.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await click('aside button[title="外观"]')
  await until(menuOnTop)
  check('原生浮窗遵循减少动态效果设置', await js(menu, "getComputedStyle(document.querySelector('.native-menu-panel')).animationName==='none'"))
  await click('aside button[title="外观"]')
  check('减少动态效果时无需等待不存在的动画即可关闭', await until(() => !menu.getVisible()))
  await menu.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] })
  menu.webContents.debugger.detach()
  await click('aside > div:last-child > button')
  check('收起侧栏后网页随内容区域缩放', !!(await until(() => nativeView()?.getBounds().x === 56)))
  const navCount = await js(win, "document.querySelectorAll('aside nav button').length")
  for (let index = 0; index < navCount; index++) {
    const selector = `aside nav button[data-overlay-probe="${index}"]`
    await js(win, `document.querySelectorAll('aside nav button')[${index}].setAttribute('data-overlay-probe','${index}')`)
    check(`收起侧栏第 ${index + 1} 项 Tooltip 位于实时网页之上`, await hoverSelector(selector))
    // Native visibility precedes the presentation IPC. Wait for that render, not a timer.
    check(`第 ${index + 1} 项 Tooltip 有入场动画`, await waitFor(menu, "document.querySelector('[role=tooltip]')?.dataset.phase==='open'&&getComputedStyle(document.querySelector('[role=tooltip]')).animationName==='slide-up'"))
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 0, y: 0 })
    check(`移出侧栏第 ${index + 1} 项会关闭原生 Tooltip`, await until(() => !menu.getVisible()))
    check(`第 ${index + 1} 项 Tooltip 播完退场动画`, await js(menu, "window.menuAnimations.at(-1)?.event==='animationend' && window.menuAnimations.at(-1)?.name==='fade-out'"))
  }
  check('菜单与 Tooltip 首帧均已处于网页上层', menuShows >= 10 && stackingFailures === 0,
    JSON.stringify({ menuShows, stackingFailures }))
  check('打开菜单、换主题、换语言、悬停全程从未隐藏网页', pageHides === 0, String(pageHides))
  view.setVisible = originalPageVisible
  menu.setVisible = originalMenuVisible
  await click('aside > div:last-child > button')
  await until(() => nativeView()?.getBounds().x === 160)
  const actual = view.getBounds()
  const expected = await js(win, `(()=>{const r=document.querySelector('[data-probe=dashboard-host]').getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}})()`)
  // Fractional DPI/layout pixels can extend a rounded CSS rect one pixel beyond contentSize.
  const [contentWidth, contentHeight] = win.getContentSize()
  expected.width = Math.min(expected.width, contentWidth - expected.x)
  expected.height = Math.min(expected.height, contentHeight - expected.y)
  check('内嵌网页边界不覆盖标题栏和侧栏', JSON.stringify(actual) === JSON.stringify(expected), JSON.stringify({ actual, expected }))
  await click('[data-publish-mode=local]')
  check('切换本地模式关闭网页并隐藏两项入口', !!(await until(() => !nativeView())) && await waitFor(win,
    `!document.querySelector('[data-probe=anibt-web-account]')&&!document.querySelector('[data-probe=anibt-dashboard]')&&!document.querySelector('[data-probe=dashboard-page]')`))
  await click('[data-publish-mode=anibt]')
  await click('[data-probe=anibt-dashboard]')
  const cachedDashboard = nativeView()
  const cachedDashboardId = cachedDashboard?.webContents.id
  const cachedLoads = groupLoads
  await until(() => nativeView()?.getVisible())
  view = nativeView()
  check('重新打开仪表盘保留登录且不重新加载', view?.webContents.getURL() === 'https://anibt.net/groups' && view?.webContents.id === cachedDashboardId && groupLoads === cachedLoads)
  await click('[data-probe=anibt-web-account]')
  check('离开仪表盘隐藏网页并释放菜单视图', !!(await until(() => nativeView() && !nativeView().getVisible() && !menuView())))
  await click('[data-probe=web-logout]')
  check('退出调用站点退出接口并清除本机会话', await waitFor(win, `document.querySelector('[role=status]')?.textContent.includes('已退出')`) && (await webSession.cookies.get({})).length === 0)
  await click('[data-probe=web-check]')
  check('退出后检查不会重新填回旧 Cookie', await waitFor(win, `document.querySelector('[role=status]')?.textContent.includes('尚未登录')`))
  await webSession.cookies.set({ url: 'https://anibt.net', name: 'offline-session', value: 'verified' })
  await click('[data-probe=web-clear]')
  check('清除 Cookie 无需服务器且保留填写的凭据', await waitFor(win,
    `document.querySelector('[role=status]')?.textContent.includes('已清除')&&document.querySelector('#anibt-web-password').value==='web-probe-password'`)
    && (await webSession.cookies.get({})).length === 0)
  check('自动保存不会复活已清除的 Cookie', await waitFor(win,
    `window.api.loadStore().then(d=>d.anibtWebAccount.cookies.length===0&&d.anibtWebAccount.password==='web-probe-password')`))
  const configDir = path.join(sandbox, 'AniBT Publish')
  check('网页凭据和 Cookie 不落入明文配置', !!(await until(() => {
    const file = path.join(configDir, 'config.json')
    if (!fs.existsSync(file)) return false
    const text = fs.readFileSync(file, 'utf8')
    const secretFile = path.join(configDir, 'secrets.json')
    return !text.includes('web-probe-password') && !text.includes('probe@example.invalid') && !text.includes('only-human')
      && fs.existsSync(secretFile) && !fs.readFileSync(secretFile, 'utf8').includes('web-probe-password')
  })))
  await click('[data-probe=anibt-dashboard]')
  await until(() => nativeView()?.getVisible())
  const anonymousDashboard = nativeView()
  await click('[data-probe=anibt-web-account]')
  const beforeRelogin = groupLoads
  await click('[data-probe=web-login]')
  login = await until(challengeView)
  if (!login) throw new Error('Relogin verification was not created')
  await waitFor(login, "window.formState?.password==='web-probe-password'")
  login.webContents.focus()
  await clickElementAt(login, "document.querySelector('#human')")
  check('登录成功刷新原先未登录的缓存仪表盘', await waitFor(win, "document.querySelector('[role=status]')?.textContent.includes('网页已登录')") &&
    !!(await until(() => groupLoads > beforeRelogin && anonymousDashboard.webContents.getURL() === 'https://anibt.net/groups')) && !anonymousDashboard.getVisible())
  // Regression for route-switch races: leaving a cached dashboard must not re-show it.
  await js(win, `location.hash='/anibt-dashboard'`)
  await waitFor(win, `document.querySelector('[data-probe=dashboard-page]')`)
  await nav(win, 0)
  check('切页中取消加载不会重新显示网页', await waitFor(win, `!document.querySelector('[data-probe=dashboard-page]')`) && !!(await until(() => nativeView() && !nativeView().getVisible())))
}

module.exports = { isolateSession, run }
