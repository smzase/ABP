/**
 * 冒烟测试：从打包产物真实拉起一次，确认「打得出来也跑得起来」。
 *
 * 判定：
 * - 存活 ≥12s → PASS
 * - 提前退出且有明确 GPU 致命错误（无 JS 异常）→ 环境限制，SKIP
 * - 其他提前退出 / JS 异常 → FAIL；boot 日志或 code=0 不能证明窗口启动成功
 *
 * 运行：node scripts/smoke-test.mjs [exe路径]
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const crashLog = path.join(os.tmpdir(), 'abp-crash.log')

function findExe(arch = process.env.ABP_SMOKE_ARCH ?? process.arch) {
  const unpacked = arch === 'x64' ? 'win-unpacked' : `win-${arch}-unpacked`
  const candidates = [
    path.join(root, 'release', unpacked, 'AniBT Publish.exe'),
    path.join(root, 'dist-release', unpacked, 'AniBT Publish.exe'),
    path.join(root, 'release-test', unpacked, 'AniBT Publish.exe')
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return null
}

const exe = process.argv[2] ?? findExe()
if (!exe) {
  const arch = process.env.ABP_SMOKE_ARCH ?? process.arch
  console.error(`找不到 Windows ${arch} 打包产物 exe，请先运行 npm run pack:win -- --${arch}`)
  process.exit(1)
}

function readCrashLog() {
  try {
    return fs.readFileSync(crashLog, 'utf-8')
  } catch {
    return ''
  }
}

const logBefore = readCrashLog()

console.log(`拉起 ${exe}（12 秒观察窗口）…`)
const env = { ...process.env, NODE_OPTIONS: '', ANIBT_DISABLE_GPU: '1', ABP_DEBUG: '1' }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(exe, [], {
  env,
  stdio: ['ignore', 'pipe', 'pipe']
})

let stderr = ''
let observed = false
let observationTimer
let shutdownTimer
child.stderr.on('data', (d) => {
  stderr += d.toString()
})

child.on('error', (error) => {
  console.error(`FAIL：无法启动产物：${error.message}`)
  process.exit(1)
})

child.on('exit', (code) => {
  clearTimeout(observationTimer)
  clearTimeout(shutdownTimer)
  const newLog = readCrashLog().slice(logBefore.length)
  const booted = /boot:/.test(newLog)
  const hasJsError = /uncaughtException|unhandledRejection/.test(newLog)
  const gpuFatal = /GPU process isn't usable|Failed to create GL context/i.test(stderr + newLog)
  if (hasJsError) {
    console.error('FAIL：主进程抛出 JS 异常：')
    console.error(newLog)
    process.exit(1)
  }
  if (observed) {
    console.log('进程稳定存活 12 秒且没有 JS 异常，冒烟通过 ✓')
    process.exit(0)
  }
  if (gpuFatal) {
    console.log(
      `SKIP：检测到 GPU 致命错误（code=${code}，boot=${booted}），当前环境未完成窗口启动验证。`
    )
    process.exit(0)
  }
  console.error(`FAIL：进程提前退出（code=${code}，boot=${booted}），未完成 12 秒观察`)
  if (stderr) console.error(stderr.slice(-2000))
  process.exit(1)
})

observationTimer = setTimeout(() => {
  observed = true
  child.kill('SIGTERM')
  shutdownTimer = setTimeout(() => {
    console.error('FAIL：受测进程未能在测试结束后退出')
    process.exit(1)
  }, 5000)
}, 12000)
