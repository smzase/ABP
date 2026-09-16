// 启动期致命错误文件日志：GUI 子系统没有控制台，打包后排障只能靠文件
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

function crashLog(msg: string): void {
  try {
    fs.appendFileSync(path.join(os.tmpdir(), 'abp-crash.log'), `[${new Date().toISOString()}] ${msg}\n`)
  } catch {
    /* ignore */
  }
}

process.on('uncaughtException', (err) => {
  crashLog(`uncaughtException: ${err.stack ?? err}`)
})
process.on('unhandledRejection', (reason) => {
  crashLog(`unhandledRejection: ${String(reason)}`)
})

import { app, BrowserWindow } from 'electron'
import { createMainWindow } from './window.ts'
import { ConfigStore } from './store.ts'
import { registerIpc } from './ipc.ts'
import { applyProxy, provideProxyCredentials } from './proxy.ts'

if (process.env.ABP_DEBUG === '1') {
  crashLog(`boot: ANIBT_DISABLE_GPU=${process.env.ANIBT_DISABLE_GPU} platform=${process.platform}`)
}

// CI / 虚拟机 / 远程桌面等无显卡环境的逃生开关：必须在 app.whenReady() 之前设置。
// 注意：不要加 disable-software-rasterizer —— 它会连 SwiftShader 软渲染兜底一起杀掉
if (process.env.ANIBT_DISABLE_GPU === '1') {
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-compositing')
  app.disableHardwareAcceleration()
}

// 单实例
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  const store = new ConfigStore()

  // 代理认证（自定义代理带用户名密码时）
  app.on('login', (event, _webContents, _details, authInfo, callback) => {
    if (provideProxyCredentials(authInfo, callback)) {
      event.preventDefault()
    } else {
      callback()
    }
  })

  void app.whenReady().then(async () => {
    // 启动时应用已保存的代理
    const data = store.load()
    await applyProxy(data.settings.proxy)

    registerIpc(store)
    createMainWindow(data.settings.appearance.mode)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow(store.load().settings.appearance.mode)
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
