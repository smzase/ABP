// node scripts/startup-probe.mjs <Windows exe> [runs=3]
// The debugger injects test isolation before app code runs; production code is unchanged.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'

assert.equal(process.platform, 'win32', 'This probe isolates the Windows configuration directory only.')
const exe = path.resolve(process.argv[2] ?? '')
assert.ok(fs.statSync(exe).isFile() && exe.endsWith('.exe'), 'Pass the packaged executable path.')
const runs = Number(process.argv[3] ?? 3)
assert.ok(Number.isInteger(runs) && runs >= 1 && runs <= 10)

async function unusedPort() {
  const server = net.createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

async function connectDebugger(url) {
  const socket = new WebSocket(url)
  await once(socket, 'open')
  let nextId = 0
  const pending = new Map()
  let resolvePaused
  const paused = new Promise(resolve => { resolvePaused = resolve })
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (message.method === 'Debugger.paused') resolvePaused(message.params)
    const task = pending.get(message.id)
    if (task) {
      pending.delete(message.id)
      clearTimeout(task.timer)
      if (message.error) task.reject(new Error(JSON.stringify(message.error)))
      else task.resolve(message.result)
    }
  })
  socket.addEventListener('close', () => {
    for (const task of pending.values()) {
      clearTimeout(task.timer)
      task.reject(new Error('Debugger disconnected'))
    }
    pending.clear()
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Debugger timeout: ${method}`))
    }, 5000)
    pending.set(id, { resolve, reject, timer })
    socket.send(JSON.stringify({ id, method, params }))
  })
  return { socket, send, paused }
}

async function measure() {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'abp-startup-'))
  const resultFile = path.join(sandbox, 'startup.json')
  const port = await unusedPort()
  const env = { ...process.env, NODE_OPTIONS: '', TEMP: sandbox, TMP: sandbox }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  delete env.ANIBT_DISABLE_GPU
  const started = Date.now()
  const child = spawn(exe, [`--inspect-brk=127.0.0.1:${port}`], { env, stdio: 'ignore' })
  const exited = once(child, 'exit')
  let debuggerClient
  let timer
  // The inspected app and its descendants belong to this launch, not an existing user window.
  let appPid
  try {
    const deadline = started + 45_000
    let target
    while (!target && Date.now() < deadline) {
      assert.equal(child.exitCode, null, 'Launcher exited before starting Electron.')
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) })
        target = (await response.json()).find(item => item.webSocketDebuggerUrl)
      } catch { /* Wait for extraction and the main-process inspector. */ }
      if (!target) await wait(25)
    }
    assert.ok(target, 'The packaged main process did not start within 45 seconds.')
    const inspectorReady = Date.now()
    debuggerClient = await connectDebugger(target.webSocketDebuggerUrl)
    await debuggerClient.send('Debugger.enable')
    await debuggerClient.send('Runtime.runIfWaitingForDebugger')
    const paused = await Promise.race([
      debuggerClient.paused,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Main process did not pause')), 5000) })
    ])
    clearTimeout(timer)
    const injected = await debuggerClient.send('Debugger.evaluateOnCallFrame', {
      callFrameId: paused.callFrames[0].callFrameId,
      returnByValue: true,
      expression: `(() => {
        const { app, session } = require('electron')
        const fs = require('node:fs')
        app.setPath('documents', ${JSON.stringify(sandbox)})
        app.setPath('userData', ${JSON.stringify(sandbox)})
        app.once('ready', () => {
          session.defaultSession.webRequest.onBeforeRequest(
            { urls: ['http://*/*', 'https://*/*'] }, (_, callback) => callback({ cancel: true })
          )
        })
        const timings = { pid: process.pid }
        app.once('browser-window-created', (_, win) => {
          win.once('show', () => {
            timings.shown = Date.now()
            fs.writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify(timings))
          })
          win.webContents.once('did-finish-load', () => {
            const interval = setInterval(async () => {
              const ready = await win.webContents.executeJavaScript(
                "!!document.querySelector('aside nav button') && !!document.querySelector('main button.border-dashed')"
              )
              if (ready) {
                clearInterval(interval)
                timings.interactive = Date.now()
                fs.writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify(timings))
                setTimeout(() => app.quit(), 500)
              }
            }, 25)
          })
        })
        return process.pid
      })()`
    })
    assert.ok(!injected.exceptionDetails, JSON.stringify(injected.exceptionDetails))
    appPid = injected.result.value
    const resumed = Date.now()
    await debuggerClient.send('Debugger.resume')
    let result
    while (Date.now() < deadline) {
      try { result = JSON.parse(fs.readFileSync(resultFile, 'utf8')) } catch { /* Not ready. */ }
      if (result?.shown && result?.interactive) break
      await wait(25)
    }
    assert.ok(result?.shown && result?.interactive, 'Window did not become visible and interactive.')
    const debuggerPause = resumed - inspectorReady
    return {
      mainStartedMs: inspectorReady - started,
      windowShownMs: result.shown - started - debuggerPause,
      interactiveMs: Math.max(result.shown, result.interactive) - started - debuggerPause,
      debuggerPauseMs: debuggerPause
    }
  } finally {
    clearTimeout(timer)
    if (debuggerClient) {
      debuggerClient.socket.close()
    }
    let timeout
    const ended = await Promise.race([exited.then(() => true), new Promise(resolve => { timeout = setTimeout(() => resolve(false), 8000) })])
    clearTimeout(timeout)
    if (!ended) {
      const cleanup = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      await once(cleanup, 'exit')
    }
    if (appPid) {
      let stillRunning = false
      try { process.kill(appPid, 0); stillRunning = true } catch { /* Already exited. */ }
      if (stillRunning) {
        const appCleanup = spawn('taskkill', ['/PID', String(appPid), '/T', '/F'], { stdio: 'ignore' })
        await once(appCleanup, 'exit')
      }
    }
    try { fs.rmSync(sandbox, { recursive: true, force: true }) } catch { /* Locked cache files can remain until Windows releases them. */ }
  }
}

const results = []
for (let i = 0; i < runs; i++) {
  const sample = await measure()
  results.push(sample)
  console.log(JSON.stringify({ run: i + 1, ...sample }))
}
const median = key => results.map(result => result[key]).sort((a, b) => a - b)[Math.floor(results.length / 2)]
console.log(JSON.stringify({
  exe, bytes: fs.statSync(exe).size, runs,
  median: { mainStartedMs: median('mainStartedMs'), windowShownMs: median('windowShownMs'), interactiveMs: median('interactiveMs') }
}, null, 2))
