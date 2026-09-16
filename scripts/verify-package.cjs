// electron-builder afterPack：三端都检查实际归档，再生成安装包。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const asar = require('@electron/asar')

module.exports = function verifyPackage(context) {
  const resourcesDir = context.packager.getResourcesDir(context.appOutDir)
  if (context.electronPlatformName === 'win32' || context.electronPlatformName === 'linux') {
    const locales = fs.readdirSync(path.join(context.appOutDir, 'locales')).filter(name => name.endsWith('.pak')).sort()
    assert.deepEqual(locales, ['en-US.pak', 'zh-CN.pak', 'zh-TW.pak'], 'Electron should only contain supported locales')
  }
  const archive = path.join(resourcesDir, 'app.asar')
  const entries = asar.listPackage(archive).map((entry) => entry.replace(/\\/g, '/').replace(/^\//, ''))
  const unexpected = entries.filter(
    (entry) =>
      entry.split('/').includes('node_modules') ||
      !(entry === 'package.json' || entry === 'out' || entry.startsWith('out/'))
  )
  assert.equal(unexpected.length, 0, `产物混入额外项目文件：${unexpected.join(', ')}`)
  for (const required of ['package.json', 'out/main/index.js', 'out/preload/index.js', 'out/renderer/index.html']) {
    assert.ok(entries.includes(required), `产物缺少必要文件：${required}`)
  }
  const metadata = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'))
  assert.equal(Object.keys(metadata.dependencies ?? {}).length, 0, '产物不应声明未打包的运行时依赖')
  for (const extra of ['app.asar.unpacked', 'app', 'node_modules']) {
    const directory = path.join(resourcesDir, extra)
    assert.ok(!fs.existsSync(directory), `产物不应携带额外应用目录：${directory}`)
  }
  console.log(`  ✓ 归档检查通过：仅含 out/ + package.json，无 node_modules（${(fs.statSync(archive).size / 1024 / 1024).toFixed(2)} MiB）`)
}
