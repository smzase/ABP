import { BrowserWindow, shell } from 'electron'
import path from 'node:path'
import type { ThemeMode } from '../shared/types.ts'

/** 无边框主窗口：不用系统标题栏，标题栏由渲染进程自绘（且不写项目名） */
export function createMainWindow(themeMode: ThemeMode = 'light'): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    frame: false,
    // 首帧底色跟随已保存的主题，避免浅色模式下闪一下深色
    backgroundColor: themeMode === 'dark' ? '#191a1b' : '#fafafa',
    autoHideMenuBar: true,
    webPreferences: {
      // electron-vite 默认产物为 CJS：out/preload/index.js
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // 外链一律交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  return win
}
