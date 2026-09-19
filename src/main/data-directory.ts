import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

/** The locator stays at the original default path; application data can move. */
export class DataDirectory {
  private active: string | undefined
  private readonly locator: string
  private readonly defaultDir: string

  constructor(defaultDir: string) {
    this.defaultDir = defaultDir
    this.locator = path.join(defaultDir, 'data-location.json')
  }

  get(): string {
    if (this.active) return this.active
    if (!fs.existsSync(this.locator)) return (this.active = this.defaultDir)
    const saved: unknown = JSON.parse(fs.readFileSync(this.locator, 'utf8'))
    const target = (saved as { directory?: unknown })?.directory
    if (typeof target !== 'string' || !path.isAbsolute(target)) throw new Error('Invalid data directory locator')
    if (!fs.statSync(target).isDirectory()) throw new Error('Data directory is unavailable')
    return (this.active = target)
  }

  /** Copy first, verify every file, then atomically commit the locator. Never remove the source. */
  change(target: string): string {
    if (!path.isAbsolute(target)) throw new Error('Please select an absolute directory path')
    const source = fs.realpathSync(this.get())
    const destination = fs.realpathSync(target)
    if (source === destination) return source
    const related = (a: string, b: string): boolean => {
      const relative = path.relative(a, b)
      return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
    }
    if (related(source, destination) || related(destination, source)) {
      throw new Error('DATA_DIR_RELATED')
    }
    if (!fs.statSync(destination).isDirectory() || fs.readdirSync(destination).length > 0) {
      throw new Error('DATA_DIR_NOT_EMPTY')
    }
    const names = fs.readdirSync(source).filter(name =>
      name === 'config.json' || name === 'secrets.json' || name === 'pending-torrents' || /^config\.json\.broken-\d+\.json$/.test(name))
    const files: Array<{ relative: string; hash: string }> = []
    const hash = (file: string): string => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
    const inspect = (relative: string): void => {
      const file = path.join(source, relative)
      const stat = fs.lstatSync(file)
      if (stat.isSymbolicLink()) throw new Error('Data directory contains a symbolic link; migration cancelled')
      if (stat.isDirectory()) for (const name of fs.readdirSync(file)) inspect(path.join(relative, name))
      else if (stat.isFile()) files.push({ relative, hash: hash(file) })
      else throw new Error('Unsupported file in data directory')
    }
    for (const name of names) inspect(name)
    for (const name of names) fs.cpSync(path.join(source, name), path.join(destination, name), { recursive: true, force: false, errorOnExist: true })
    for (const file of files) {
      if (hash(path.join(destination, file.relative)) !== file.hash) throw new Error('Data verification failed; original directory remains active')
    }
    fs.mkdirSync(this.defaultDir, { recursive: true })
    const temporary = this.locator + `.${process.pid}.tmp`
    fs.writeFileSync(temporary, JSON.stringify({ directory: destination }), { encoding: 'utf8', mode: 0o600 })
    fs.renameSync(temporary, this.locator)
    this.active = destination
    return destination
  }
}
