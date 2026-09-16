import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'

/**
 * 配置文件目录约定：
 * - Windows：用户 Documents 下的「AniBT Publish」文件夹（单 exe 便携版同样放这里）
 * - macOS：~/Library/Application Support/AniBT Publish
 * - Linux：$XDG_CONFIG_HOME/anibt-publish（默认 ~/.config/anibt-publish）
 */
export function getConfigDir(): string {
  if (process.platform === 'win32') {
    return path.join(app.getPath('documents'), 'AniBT Publish')
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'AniBT Publish')
  }
  const xdg = process.env.XDG_CONFIG_HOME
  return path.join(xdg && xdg.length > 0 ? xdg : path.join(os.homedir(), '.config'), 'anibt-publish')
}

export function getConfigFile(): string {
  return path.join(getConfigDir(), 'config.json')
}

/** 站点 API Key 单独加密存放，不与 config.json 混在一起（见 main/secrets.ts） */
export function getSecretsFile(): string {
  return path.join(getConfigDir(), 'secrets.json')
}
