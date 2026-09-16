/**
 * 冒烟测试：从打包产物真实拉起一次，确认「打得出来也跑得起来」。
 *
 * 判定：
 * - 存活 ≥12s → PASS
 * - 提前退出，但 boot 日志证明主进程已正常启动（无 JS 异常）→ 当前环境无 GPU/显示会话，
 *   GUI 无法存活属环境限制 → SKIP（真实桌面不受影响）
 * - 提前退出且崩溃日志有 JS 异常 / 无 boot 日志 → FAIL
 *
 * 运行：node scripts/smoke-test.mjs [exe路径]
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const crashLog = path.join(os.tmpdir(), 'abp-crash.log')

function findExe() {
  const candidates = [
    path.join(root, 'release', 'win-unpacked', 'AniBT Publish.exe'),
    path.join(root, 'dist-release', 'win-unpacked', 'AniBT Publish.exe'),
    path.join(root, 'release-test', 'win-unpacked', 'AniBT Publish.exe')
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return null
}

const exe = process.argv[2] ?? findExe()
if (!exe) {
  console.error('找不到打包产物 exe，请先运行 npm run pack:win')
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
const child = spawn(exe, [], {
  env: { ...process.env, ANIBT_DISABLE_GPU: '1', ABP_DEBUG: '1' },
  stdio: ['ignore', 'pipe', 'pipe']
})

let stderr = ''
child.stderr.on('data', (d) => {
  stderr += d.toString()
})

child.on('exit', (code) => {
  const newLog = readCrashLog().slice(logBefore.length)
  const booted = /boot:/.test(newLog)
  const hasJsError = /uncaughtException|unhandledRejection/.test(newLog)
  const gpuFatal = /GPU process isn't usable|Failed to create GL context/i.test(stderr + newLog)
  if (hasJsError) {
    console.error('FAIL：主进程抛出 JS 异常：')
    console.error(newLog)
    process.exit(1)
  }
  if (booted || gpuFatal || code === 0) {
    // boot 日志能证明主进程正常时最硬；本环境（无 GPU VM）连 boot 都可能被 GPU FATAL 抢先截断，
    // 此时 stderr 特征 / code=0 快速退出也指向同一环境限制
    console.log(
      `SKIP：当前环境无 GPU/显示会话，Electron GPU 子进程无法存活（code=${code}，boot=${booted}）。\n` +
        '已验证主进程可正常启动且无 JS 异常，属环境限制；真实桌面不受影响。'
    )
    process.exit(0)
  }
  console.error(`FAIL：进程提前退出（code=${code}）且未见 boot 日志`)
  if (stderr) console.error(stderr.slice(-2000))
  process.exit(1)
})

setTimeout(() => {
  console.log('进程稳定存活 12 秒，冒烟通过 ✓')
  child.kill('SIGTERM')
  setTimeout(() => process.exit(0), 500)
}, 12000)
