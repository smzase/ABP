// Windows-only benchmark; never reads the user's configuration or calls remote APIs.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { app, BrowserWindow, session } = require('electron')

if (process.platform !== 'win32') throw new Error('This benchmark isolates the Windows config directory only.')
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'abp-memory-'))
app.setPath('documents', sandbox)
app.setPath('userData', sandbox)
app.commandLine.appendSwitch('enable-precise-memory-info')
app.once('ready', () => {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (_details, callback) => callback({ cancel: true })
  )
})

require(path.join(__dirname, '..', 'out', 'main', 'index.js'))

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const watchdog = setTimeout(() => app.exit(1), 30_000)
const median = (values) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)]
const mib = (bytes) => Number((bytes / 1024 / 1024).toFixed(2))

app.whenReady().then(async () => {
  try {
    let win
    const deadline = Date.now() + 15_000
    for (;;) {
      win = BrowserWindow.getAllWindows()[0]
      if (win && !win.webContents.isLoading() && await win.webContents.executeJavaScript(
        "!!document.querySelector('aside nav button')"
      )) break
      if (Date.now() >= deadline) throw new Error('Startup did not reach the initial page.')
      await wait(100)
    }

    const samples = []
    // Sample over a fixed interval to expose variance, not to wait for UI readiness.
    for (let i = 0; i < 7; i++) {
      await wait(500)
      const metrics = app.getAppMetrics()
      const heap = await win.webContents.executeJavaScript('performance.memory.usedJSHeapSize')
      samples.push({
        workingSet: metrics.reduce((sum, p) => sum + p.memory.workingSetSize * 1024, 0),
        privateBytes: metrics.reduce((sum, p) => sum + (p.memory.privateBytes ?? 0) * 1024, 0),
        heap
      })
    }
    console.log(JSON.stringify({
      electron: process.versions.electron,
      arch: process.arch,
      gpuDisabled: process.env.ANIBT_DISABLE_GPU === '1',
      samples: samples.length,
      medianMiB: {
        workingSet: mib(median(samples.map(s => s.workingSet))),
        privateBytes: mib(median(samples.map(s => s.privateBytes))),
        rendererHeap: mib(median(samples.map(s => s.heap)))
      }
    }, null, 2))
    clearTimeout(watchdog)
    try { fs.rmSync(sandbox, { recursive: true, force: true }) } catch { /* Session files can remain locked until exit. */ }
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
