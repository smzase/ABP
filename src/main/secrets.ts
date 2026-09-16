import fs from 'node:fs'
import path from 'node:path'
import { getConfigDir, getSecretsFile } from './paths.ts'
import { openSecrets, sealSecrets, type SecretMap } from '../shared/secrets-crypto.ts'

/**
 * 站点 API Key 的独立加密存储（secrets.json），与 config.json 彻底分家。
 * 加解密逻辑在 src/shared/secrets-crypto.ts（纯函数，有单测），这里只管文件 IO。
 */

/** 读取 API Key 映射。文件缺失 / 损坏 / 认证失败一律返回空表，绝不抛异常、绝不打日志内容 */
export function loadSecrets(): SecretMap {
  try {
    return openSecrets(JSON.parse(fs.readFileSync(getSecretsFile(), 'utf-8')))
  } catch {
    // ENOENT / JSON 坏：当作没有密钥，让用户重填
    return {}
  }
}

/** 原子写入。空表时删除文件，不留空壳 */
export function saveSecrets(map: SecretMap): void {
  const file = getSecretsFile()
  if (Object.keys(map).length === 0) {
    try {
      fs.rmSync(file, { force: true })
    } catch {
      /* 删不掉也不影响主流程 */
    }
    return
  }
  const dir = getConfigDir()
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `.secrets-${process.pid}.tmp`)
  fs.writeFileSync(tmp, JSON.stringify(sealSecrets(map)), { encoding: 'utf-8', mode: 0o600 })
  fs.renameSync(tmp, file)
}
