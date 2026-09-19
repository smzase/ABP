const fs = require('node:fs')
const path = require('node:path')
const { dialog, ipcMain } = require('electron')

async function run(ctx) {
  const { win, js, check, waitFor, clickElementAt, clickByText, typeText, nav, sandbox, pressKey } = ctx
  const click = selector => clickElementAt(win, `document.querySelector(${JSON.stringify(selector)})`)
  const otherSettings = async () => {
    await nav(win, 4)
    await waitFor(win, "[...document.querySelectorAll('main button')].some(x=>x.textContent.trim()==='其他')")
    await clickByText(win, '其他', { exact: true })
    await waitFor(win, "document.querySelector('[data-probe=config-directory]')?.textContent.length>0")
  }
  const input = async (selector, text) => {
    await js(win, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});e.focus();e.select()})()`)
    await typeText(win, text)
  }
  await nav(win, 1)
  await waitFor(win, "document.querySelector('main')?.textContent.includes('添加番剧模板')")
  await clickByText(win, '添加番剧模板')
  check('添加番剧模板可输入中文名', await waitFor(win, "document.querySelector('[data-probe=manual-anime-name]')"))
  await input('[data-probe=manual-anime-name]', '手动模板回归')
  await click('[data-probe=add-anime-by-name]')
  check('仅中文名即可创建模板', await waitFor(win, "window.api.loadStore().then(d=>d.animeTemplates.some(x=>x.names.zh==='手动模板回归'&&x.bgmId===null&&x.mikanBangumiId===null))"))
  await clickElementAt(win, "[...document.querySelectorAll('main [draggable=true]')].find(x=>x.textContent.includes('手动模板回归'))")
  check('bgmId 右侧有搜索按钮', await waitFor(win, "document.querySelector('[data-probe=bgm-search-open]')"))
  check('两个 ID 搜索按钮各自在对应输入框右侧同一排', await js(win, `(()=>{
    const r=id=>document.querySelector('[data-probe='+id+']').getBoundingClientRect();
    const a=r('anime-bgm-id'),b=r('bgm-search-open'),c=r('anime-mikan-bangumi-id'),d=r('mikan-bangumi-search-open');
    return b.left>=a.right&&Math.abs(b.top-a.top)<2&&d.left>=c.right&&Math.abs(d.top-c.top)<2&&Math.abs(a.top-c.top)<2
  })()`))
  check('模板自定义标签位于原名右侧同一排', await js(win, `(()=>{
    const a=document.querySelector('[data-probe=anime-native-name]').getBoundingClientRect();
    const b=document.querySelector('[data-probe=anime-custom-tags]').getBoundingClientRect();
    return b.left>=a.right&&Math.abs(a.top-b.top)<2
  })()`))
  if (process.env.ABP_PROBE_CAPTURE_DIR) {
    fs.mkdirSync(process.env.ABP_PROBE_CAPTURE_DIR, { recursive: true })
    fs.writeFileSync(path.join(process.env.ABP_PROBE_CAPTURE_DIR, 'anime-template.png'), (await win.webContents.capturePage()).toPNG())
  }
  await click('[data-probe=bgm-search-open]')
  await waitFor(win, "document.querySelector('[data-probe=bgm-search-query]')")
  check('bgmId 搜索预填当前中文名', await js(win, "document.querySelector('[data-probe=bgm-search-query]').value==='手动模板回归'"))
  await input('[data-probe=bgm-search-query]', '_probe_bgm_')
  check('bgmId 搜索显示离线候选', await waitFor(win, "[...document.querySelectorAll('[role=dialog] button')].some(x=>x.textContent.includes('bgm:777001'))"))
  await clickElementAt(win, "[...document.querySelectorAll('[role=dialog] button')].find(x=>x.textContent.includes('bgm:777001'))")
  check('选中只更新 bgmId，不覆盖中文名', await waitFor(win, "window.api.loadStore().then(d=>d.animeTemplates.some(x=>x.names.zh==='手动模板回归'&&x.bgmId===777001))"))
  check('搜索选择后 ID 输入框同步', await js(win, "document.querySelector('[data-probe=anime-bgm-id]').value==='777001'"))

  await input('[data-probe=anime-custom-tags] input', 'WEB')
  await pressKey(win, 'Enter')
  await input('[data-probe=anime-custom-tags] input', 'HDR')
  await pressKey(win, 'Enter')
  check('模板复用 InputTag 添加标签', await js(win, "document.querySelectorAll('[data-probe=anime-custom-tags] [draggable=true]').length===2"))
  await js(win, `(()=>{const tags=document.querySelectorAll('[data-probe=anime-custom-tags] [draggable=true]');const dt=new DataTransfer();
    tags[1].dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));
    tags[0].dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt}));
    tags[0].dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));
    tags[1].dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));})()`)
  check('标签拖拽顺序保存到模板', await waitFor(win, "window.api.loadStore().then(d=>d.animeTemplates.find(x=>x.bgmId===777001)?.customTags.join(' ')==='HDR WEB')"))
  check('番剧模板变量默认收起且有图标', await js(win, "(()=>{const b=document.querySelector('[data-probe=anime-variables-trigger]');return b?.getAttribute('data-state')==='closed'&&!!b.querySelector('svg')})()"))
  await js(win, "document.querySelector('[data-probe=anime-variables-trigger]').scrollIntoView({block:'center'})")
  await click('[data-probe=anime-variables-trigger]')
  check('展开后显示五组变量，无各组折叠按钮', await waitFor(win, "(()=>{const e=document.querySelector('[data-probe=anime-template-variables]');return e&&e.children.length===5&&!e.querySelector('[aria-expanded]')})()"))
  check('titleZh 在简繁显式变量前面', await js(win, "(()=>{const names=[...document.querySelectorAll('[data-probe=anime-template-variables] button')].map(x=>x.textContent.trim());return names.indexOf('{{titleZh}}')<names.indexOf('{{titleZhHans}}')&&names.indexOf('{{titleZhHans}}')<names.indexOf('{{titleZhHant}}')})()"))
  await input('[data-probe=anime-title-template]', '前缀尾')
  await js(win, "document.querySelector('[data-probe=anime-title-template]').setSelectionRange(2,3)")
  const variable = name => `[...document.querySelectorAll('[data-probe=anime-template-variables] button')].find(x=>x.textContent.trim()===${JSON.stringify('{{'+name+'}}')})`
  await js(win, `${variable('titleZh')}.scrollIntoView({block:'center'})`)
  await clickElementAt(win, variable('titleZh'))
  check('变量替换选区并保持光标', await js(win, "(()=>{const e=document.querySelector('[data-probe=anime-title-template]');return e.value==='前缀{{titleZh}}'&&e.selectionStart===e.value.length})()"))
  await input('[data-probe=anime-title-template]', '{{titleZh}} {{customTags}} {{version}}')
  check('模板预览带有有序标签且隐藏 v1', await waitFor(win, "document.querySelector('main')?.textContent.includes('手动模板回归 HDR WEB')"))
  const hintSharesRow = `(()=>{
    const hint=document.querySelector('[data-probe=anime-custom-title-hint]');
    const button=document.querySelector('[data-probe=anime-variables-trigger]');
    if(!hint||!button||hint.parentElement!==button.parentElement)return false;
    const a=hint.getBoundingClientRect(),b=button.getBoundingClientRect();
    return a.right<=b.left&&Math.abs(a.top+a.height/2-b.top-b.height/2)<2;
  })()`
  check('模板提示和变量按钮同排，按钮位于右侧', await js(win, hintSharesRow))
  await click('[data-probe=anime-variables-trigger]')
  check('收起变量后仍保持提示和按钮同排', await waitFor(win, "document.querySelector('[data-probe=anime-variables-trigger]')?.getAttribute('data-state')==='closed'") && await js(win, hintSharesRow))
  if (process.env.ABP_PROBE_CAPTURE_DIR) {
    await js(win, "document.querySelector('[data-probe=anime-variables-trigger]').scrollIntoView({block:'center'})")
    fs.writeFileSync(path.join(process.env.ABP_PROBE_CAPTURE_DIR, 'template-hint-row.png'), (await win.webContents.capturePage()).toPNG())
  }
  await otherSettings()
  check('设置其他显示实际数据目录', await waitFor(win, "document.querySelector('[data-probe=config-directory]')?.textContent.includes('AniBT Publish')"))
  check('其他包含字体且无旧说明', await js(win, "(()=>{const text=document.querySelector('main').textContent;return text.includes('字体')&&!text.includes('Windows 存放于')&&!text.includes('站点 API Key 不写在')})()"))
  check('本机字体枚举可用', await waitFor(win, "window.api.listFonts().then(x=>x.length>0)", { timeout: 15000 }))
  const fontNames = await js(win, 'window.api.listFonts()')
  const chosen = fontNames.find(name => name === 'Arial') || fontNames[0]
  check('字体搜索不占设置页单独一排', await js(win, "!document.querySelector('[data-probe=font-search]')"))
  await waitFor(win, "!document.querySelector('[data-probe=font-select]')?.disabled")
  await click('[data-probe=font-select]')
  check('字体搜索在下拉内部且自动获得焦点', await waitFor(win, "document.querySelector('[data-probe=font-popup]')?.contains(document.activeElement)&&document.activeElement?.matches('[data-probe=font-search]')"))
  await input('[data-probe=font-search]', chosen.toLocaleLowerCase())
  check('字体搜索筛选结果', await waitFor(win, `[...document.querySelectorAll('[role=option]')].some(x=>x.textContent.trim()===${JSON.stringify(chosen)})`))
  await clickElementAt(win, `[...document.querySelectorAll('[role=option]')].find(x=>x.textContent.trim()===${JSON.stringify(chosen)})`)
  check('选择字体立即应用客户端并保存', await waitFor(win, `getComputedStyle(document.body).fontFamily.includes(${JSON.stringify(chosen)})&&window.api.loadStore().then(d=>d.settings.appearance.fontFamily===${JSON.stringify(chosen)})`))
  if (process.env.ABP_PROBE_CAPTURE_DIR) fs.writeFileSync(path.join(process.env.ABP_PROBE_CAPTURE_DIR, 'other-settings.png'), (await win.webContents.capturePage()).toPNG())
  await waitFor(win, "!document.querySelector('[data-probe=font-popup]')")

  // Exercise large collections without installing fonts or changing the real profile.
  // The main IPC is restored to the previously enumerated cache for this probe process.
  const stressFonts = [...fontNames, ...Array.from({ length: 10000 }, (_, i) => `ABP Test Font ${String(i).padStart(5, '0')}`)]
  const replaceFontFixture = fonts => {
    ipcMain.removeHandler('system:listFonts')
    ipcMain.handle('system:listFonts', () => fonts)
  }
  replaceFontFixture(stressFonts)
  try {
    await nav(win, 1)
    await otherSettings()
    await waitFor(win, "!document.querySelector('[data-probe=font-select]')?.disabled")
    await js(win, `document.querySelector('[data-probe=font-select]').addEventListener('click',()=>{
      const start=performance.now();
      const painted=()=>{
        if(document.querySelector('[data-probe=font-popup] [role=option]'))requestAnimationFrame(()=>{window.__fontOpenMs=performance.now()-start});
        else requestAnimationFrame(painted);
      };requestAnimationFrame(painted);
    },{once:true})`)
    await click('[data-probe=font-select]')
    check('一万条字体选项只渲染可见部分', await waitFor(win, `(()=>{const options=document.querySelectorAll('[data-probe=font-popup] [role=option]');return options.length>0&&options.length<=20&&Number(options[0].getAttribute('aria-setsize'))===${stressFonts.length+1}})()`))
    await waitFor(win, 'window.__fontOpenMs>0')
    console.log(`  Font dropdown (${stressFonts.length} families): ${Math.round(await js(win, 'window.__fontOpenMs'))} ms to painted options`)
    await input('[data-probe=font-search]', '__no_such_font__')
    check('无匹配字体显示空态，不混入当前选项', await waitFor(win, "document.querySelector('[data-probe=font-popup] [role=status]')&&!document.querySelector('[data-probe=font-popup] [role=option]')"))
    await pressKey(win, 'Escape')
    check('取消搜索不更改字体，焦点返回选择按钮', await waitFor(win, `!document.querySelector('[data-probe=font-popup]')&&document.activeElement?.matches('[data-probe=font-select]')&&window.api.loadStore().then(d=>d.settings.appearance.fontFamily===${JSON.stringify(chosen)})`))
    await pressKey(win, 'Enter')
    check('键盘重新打开列表会清空搜索', await waitFor(win, "document.activeElement?.matches('[data-probe=font-search]')&&document.activeElement.value===''"))
    await pressKey(win, 'End')
    const lastOption = "[...document.querySelectorAll('[data-probe=font-popup] [role=option]')].find(x=>x.textContent.trim()==='ABP Test Font 09999')"
    check('End 键跳到虚拟列表末尾', await waitFor(win, `${lastOption}?.hasAttribute('data-highlighted')`))
    await pressKey(win, 'Enter')
    check('键盘可选中未预先渲染的末尾字体', await waitFor(win, "window.api.loadStore().then(d=>d.settings.appearance.fontFamily==='ABP Test Font 09999')"))
    await waitFor(win, "!document.querySelector('[data-probe=font-popup]')")
    await click('[data-probe=font-select]')
    check('重新打开可定位末尾已选字体', await waitFor(win, `${lastOption}?.getAttribute('data-state')==='checked'`))
    await js(win, "document.querySelector('[data-probe=font-viewport]').scrollTop=0")
    check('滚动虚拟列表仍显示首项且 DOM 数量受限', await waitFor(win, "(()=>{const options=[...document.querySelectorAll('[data-probe=font-popup] [role=option]')];return options.length<=20&&options.some(x=>x.textContent.trim()==='系统默认')})()"))
    await input('[data-probe=font-search]', 'ABP Test Font 07654')
    check('大量字体下筛选会重置滚动位置并显示唯一结果', await waitFor(win, "(()=>{const options=document.querySelectorAll('[data-probe=font-popup] [role=option]');return options.length===1&&options[0].textContent.trim()==='ABP Test Font 07654'})()"))
    await pressKey(win, 'ArrowDown')
    await pressKey(win, 'Enter')
    check('搜索后可用方向键和 Enter 选中字体', await waitFor(win, "window.api.loadStore().then(d=>d.settings.appearance.fontFamily==='ABP Test Font 07654')"))
    await waitFor(win, "!document.querySelector('[data-probe=font-popup]')")
    await click('[data-probe=font-select]')
    await input('[data-probe=font-search]', chosen)
    await clickElementAt(win, `[...document.querySelectorAll('[role=option]')].find(x=>x.textContent.trim()===${JSON.stringify(chosen)})`)
    await waitFor(win, `!document.querySelector('[data-probe=font-popup]')&&window.api.loadStore().then(d=>d.settings.appearance.fontFamily===${JSON.stringify(chosen)})`)
    if (process.env.ABP_PROBE_CAPTURE_DIR) {
      await click('[data-probe=font-select]')
      await input('[data-probe=font-search]', chosen)
      fs.writeFileSync(path.join(process.env.ABP_PROBE_CAPTURE_DIR, 'font-dropdown.png'), (await win.webContents.capturePage()).toPNG())
      await pressKey(win, 'Escape')
      await waitFor(win, "!document.querySelector('[data-probe=font-popup]')")
    }
  } finally { replaceFontFixture(fontNames) }
  await nav(win, 1)
  await waitFor(win, "document.querySelector('[data-probe=anime-bgm-id]')")
  await clickElementAt(win, "[...document.querySelectorAll('main [draggable=true]')].find(x=>x.textContent.includes('手动模板回归'))")
  check('离开再回模板，标签顺序仍存在', await waitFor(win, "[...document.querySelectorAll('[data-probe=anime-custom-tags] [draggable=true]')].map(x=>x.textContent.trim()).join(' ')==='HDR WEB'"))

  // Relocation runs last. Native folder picking is stubbed, but all copy/save/IPC paths are real.
  await otherSettings()
  await waitFor(win, "document.querySelector('[data-probe=change-data-directory]')")
  const source = await js(win, 'window.api.getConfigDir()')
  const destination = path.join(sandbox, 'moved-data')
  fs.mkdirSync(destination)
  fs.mkdirSync(path.join(source, 'pending-torrents'), { recursive: true })
  fs.writeFileSync(path.join(source, 'pending-torrents', 'migration-probe.torrent'), Buffer.from([0, 255, 42]))
  const originalPicker = dialog.showOpenDialog
  let pickerCalls = 0
  try {
    dialog.showOpenDialog = async () => { pickerCalls++; return { canceled: true, filePaths: [] } }
    // A late IPC must still attach to its requesting window if OS focus changed.
    win.blur()
    await click('[data-probe=change-data-directory]')
    check('失去系统焦点后仍能选择目录，取消不改变路径', await waitFor(win, `!document.querySelector('[data-probe=change-data-directory]')?.disabled&&window.api.getConfigDir().then(x=>x===${JSON.stringify(source)})`) && pickerCalls === 1)
    dialog.showOpenDialog = async () => { pickerCalls++; return { canceled: false, filePaths: [destination] } }
    await click('[data-probe=change-data-directory]')
    const confirmation = await waitFor(win, "document.querySelector('[role=alertdialog]')?.textContent.includes('旧目录')")
    check('迁移前展示目标与保留备份提示', confirmation, confirmation ? undefined : JSON.stringify({ pickerCalls, focused: win.isFocused() }))
    await clickByText(win, '确认', { root: 'body', exact: true, last: true })
    check('修改数据目录后路径即时更新', await waitFor(win, `document.querySelector('[data-probe=config-directory]')?.textContent===${JSON.stringify(destination)}`))
    check('迁移保留原配置和重试种子', fs.existsSync(path.join(source, 'config.json')) && fs.readFileSync(path.join(destination, 'pending-torrents', 'migration-probe.torrent')).equals(Buffer.from([0, 255, 42])))
    const stored = JSON.parse(fs.readFileSync(path.join(destination, 'config.json'), 'utf8'))
    check('迁移保留模板和字体设置', stored.animeTemplates.some(x=>x.bgmId===777001&&x.customTags.join(' ')==='HDR WEB') && stored.settings.appearance.fontFamily === chosen)
    check('加密凭据在迁移中保持一致', !fs.existsSync(path.join(source, 'secrets.json')) || fs.readFileSync(path.join(source, 'secrets.json')).equals(fs.readFileSync(path.join(destination, 'secrets.json'))))
    await clickElementAt(win, "document.querySelector('main button[aria-label=系统默认]')")
    check('切换目录后自动保存写入新路径', await waitFor(win, "window.api.loadStore().then(d=>d.settings.appearance.fontFamily==='')") && JSON.parse(fs.readFileSync(path.join(destination,'config.json'),'utf8')).settings.appearance.fontFamily === '')
    win.webContents.reload()
    check('重新加载后目录和设置仍然正确', await waitFor(win, `window.api.getConfigDir().then(x=>x===${JSON.stringify(destination)})`))
    check('重新加载后字体使用保存的设置', await waitFor(win, "getComputedStyle(document.body).fontFamily.includes('Segoe UI')"))
  } finally { dialog.showOpenDialog = originalPicker }
}

module.exports = { run }
