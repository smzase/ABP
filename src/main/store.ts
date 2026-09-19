import fs from 'node:fs'
import path from 'node:path'
import { getConfigDir, getConfigFile } from './paths.ts'
import { loadSecrets, saveSecrets } from './secrets.ts'
import { collectSecrets, mergeSecrets, redactSecrets } from '../shared/secrets-crypto.ts'
import { defaultAppData, sanitizeAppData } from '../shared/store-doc.ts'
import type { AppData } from '../shared/types.ts'

/**
 * 配置读写，两个文件：
 * - config.json    普通配置（**永远不含 apiKey**）
 * - secrets.json   站点 API Key，AES-256-GCM 加密（见 secrets.ts）
 *
 * 对渲染进程仍然只暴露一个 AppData：load 时把密钥合进 groups[].apiKey，
 * save 时再拆出来。渲染层无感知。
 *
 * 读：不存在 → 默认值；损坏 → 备份为 config.broken-<ts>.json 后回退默认值
 * 写：tmp + rename 原子写入，避免中途断电写坏
 */
export class ConfigStore {
  private data: AppData | null = null

  load(): AppData {
    if (this.data) return structuredClone(this.data)
    const file = getConfigFile()
    let parsed: unknown = null
    try {
      const text = fs.readFileSync(file, 'utf-8')
      parsed = JSON.parse(text)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT' && fs.existsSync(file)) {
        // 文件存在但坏了：备份后回退
        try {
          fs.copyFileSync(file, `${file}.broken-${Date.now()}`)
        } catch {
          /* 备份失败也继续 */
        }
      }
    }
    const doc = parsed === null ? defaultAppData() : sanitizeAppData(parsed)

    // 合并密钥。老版本把 apiKey 写在 config.json 里 —— 那里的值作为迁移来源保留，
    // 下一次 save 会把它挪进 secrets.json 并从 config.json 抹掉。
    const secrets = loadSecrets()
    mergeSecrets(doc.groups, secrets, doc.anibtWebAccount)
    // Migrate the first previously configured web account once. API publishing stays per group.
    if (!parsed || !Object.prototype.hasOwnProperty.call(parsed, 'anibtWebAccount')) {
      const old = doc.groups.find((g) => g.sites.anibt.username || g.sites.anibt.cookies.length)?.sites.anibt
      if (old) doc.anibtWebAccount = {
        username: old.username, password: old.password, cookies: old.cookies, userAgent: old.userAgent
      }
    }

    this.data = sanitizeAppData(doc)
    return structuredClone(this.data)
  }

  save(data: AppData): void {
    const clean = sanitizeAppData(data)

    // 拆分：密钥进 secrets.json，config.json 里只留空串
    saveSecrets(collectSecrets(clean.groups, clean.anibtWebAccount))

    const forDisk: AppData = {
      ...clean, groups: redactSecrets(clean.groups),
      anibtWebAccount: { username: '', password: '', cookies: [], userAgent: '' }
    }

    const dir = getConfigDir()
    const file = getConfigFile()
    fs.mkdirSync(dir, { recursive: true })
    const tmp = path.join(dir, `.config-${process.pid}.tmp`)
    fs.writeFileSync(tmp, JSON.stringify(forDisk, null, 2), 'utf-8')
    fs.renameSync(tmp, file)

    // 内存缓存保留明文（渲染进程 load 时要用）
    this.data = clean
  }
}
