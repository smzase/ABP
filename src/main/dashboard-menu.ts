import { BrowserWindow, WebContentsView, type WebContents, type MouseInputEvent, type Event } from 'electron'
import path from 'node:path'
import type { DashboardMenuAction, DashboardMenuEvent, DashboardMenuRequest, DashboardMenuSettings } from '../shared/dashboard-menu.ts'

/** A small local native view ABOVE the live remote page, never a page screenshot. */
export class DashboardMenuHost {
  readonly view: WebContentsView
  private current: DashboardMenuRequest | null = null
  private readonly loaded: Promise<void>
  private disposed = false
  private closing: { id: string; restoreFocus: boolean } | null = null
  private hideTimer?: ReturnType<typeof setTimeout>
  private readonly outsideMouse = (_event: Event, mouse: MouseInputEvent): void => {
    if (mouse.type === 'mouseDown' && this.current) {
      const id = this.current.id
      // Do not detach the focused menu in the middle of dispatching the page's
      // mouseDown: Chromium can otherwise discard that first input event.
      setImmediate(() => { if (!this.disposed) this.hide(id) })
    }
  }
  private readonly dismiss = (): void => { this.hide() }

  constructor(private readonly parent: BrowserWindow, private readonly page: WebContents) {
    this.view = new WebContentsView({ webPreferences: {
      preload: path.join(__dirname, '../preload/dashboard-menu.js'),
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: false
    } })
    this.view.setBackgroundColor('#00000000')
    this.view.setBounds({ x: 0, y: 44, width: 360, height: 240 })
    this.view.setVisible(false)
    parent.contentView.addChildView(this.view)
    const wc = this.view.webContents
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    wc.on('will-navigate', event => event.preventDefault())
    wc.on('will-redirect', event => event.preventDefault())
    wc.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        event.preventDefault()
        this.hide(undefined, true)
      }
    })
    page.on('before-mouse-event', this.outsideMouse)
    parent.on('resize', this.dismiss)
    this.loaded = process.env.ELECTRON_RENDERER_URL
      ? wc.loadURL(new URL('dashboard-menu.html', process.env.ELECTRON_RENDERER_URL).href)
      : wc.loadFile(path.join(__dirname, '../renderer/dashboard-menu.html'))
    void this.loaded.catch(() => this.hide())
  }

  private notify(event: DashboardMenuEvent): void {
    if (!this.parent.isDestroyed()) this.parent.webContents.send('anibt:dashboardMenuEvent', event)
  }

  async show(request: DashboardMenuRequest): Promise<boolean> {
    if (this.disposed || !request || typeof request.id !== 'string' || !['appearance', 'language', 'tooltip'].includes(request.kind)
      || !request.anchor || !Object.values(request.anchor).every(Number.isFinite)
      || !['top', 'bottom', 'left', 'right'].includes(request.side)) return false
    if (request.kind === 'tooltip' && this.current && this.current.kind !== 'tooltip') return false
    this.hide(undefined, false, true)
    this.current = request
    await this.loaded
    if (this.disposed || this.current?.id !== request.id) return false
    this.view.webContents.send('anibt:dashboardMenuState', request)
    return true
  }

  /** Position and raise BEFORE the first visible frame, after local layout. */
  painted(sender: WebContents, id: string, size: { width: number; height: number }): void {
    const request = this.current
    if (this.disposed || this.closing || sender !== this.view.webContents || !request || request.id !== id) return
    if (!Number.isFinite(size.width) || !Number.isFinite(size.height)) return
    const [windowWidth, windowHeight] = this.parent.getContentSize()
    const width = Math.min(windowWidth, Math.max(24, Math.ceil(size.width)))
    const height = Math.min(windowHeight, Math.max(24, Math.ceil(size.height)))
    const a = request.anchor
    let x = a.x
    let y = a.y - height - 6
    if (request.side === 'bottom') y = a.y + a.height + 6
    if (request.side === 'right' || request.side === 'left') {
      x = request.side === 'right' ? a.x + a.width + 6 : a.x - width - 6
      y = a.y + (a.height - height) / 2
    }
    const bounds = { x: Math.round(Math.max(0, Math.min(x, windowWidth - width))),
      y: Math.round(Math.max(44, Math.min(y, windowHeight - height))), width, height }
    if (JSON.stringify(bounds) !== JSON.stringify(this.view.getBounds())) this.view.setBounds(bounds)
    const wasVisible = this.view.getVisible()
    if (this.parent.contentView.children.at(-1) !== this.view) this.parent.contentView.addChildView(this.view)
    if (!wasVisible) this.view.setVisible(true)
    if (!wasVisible) sender.send('anibt:dashboardMenuPresentation', { id, phase: 'open' })
    if (!wasVisible && request.kind !== 'tooltip') sender.focus()
  }

  updateSettings(settings: DashboardMenuSettings): void {
    if (!this.current || this.disposed) return
    this.current = { ...this.current, settings }
    this.view.webContents.send('anibt:dashboardMenuState', this.current)
  }

  action(sender: WebContents, id: string, action: DashboardMenuAction): void {
    if (this.disposed || this.closing || sender !== this.view.webContents || id !== this.current?.id || this.current.kind === 'tooltip') return
    if ((action.type === 'theme' && ['light', 'dark'].includes(action.value)) ||
        (action.type === 'locale' && ['zh-CN', 'zh-TW', 'en'].includes(action.value)) ||
        (action.type === 'accent' && /^#[0-9a-f]{6}$/i.test(action.value))) {
      this.notify({ type: 'action', action })
    }
  }

  hide(id?: string, restoreFocus = false, immediate = false): void {
    if (id && this.current?.id !== id) return
    const previous = this.current
    if (!immediate && previous && this.view.getVisible() && !this.view.webContents.isDestroyed()) {
      if (this.closing) return
      this.closing = { id: previous.id, restoreFocus }
      this.view.webContents.send('anibt:dashboardMenuPresentation', { id: previous.id, phase: 'closed' })
      this.notify({ type: 'closed', id: previous.id })
      // Renderer acknowledges animationend (or reduced motion). Recover if it crashes.
      this.hideTimer = setTimeout(() => this.hidden(this.view.webContents, previous.id), 500)
      return
    }
    const notified = this.closing?.id === previous?.id
    if (this.hideTimer) clearTimeout(this.hideTimer)
    this.hideTimer = undefined
    this.closing = null
    this.current = null
    if (!this.view.webContents.isDestroyed()) {
      // Detach first. Hiding an attached WebContentsView can leave Chromium's
      // sibling page marked hidden and unable to receive its next mouse event.
      if (!this.parent.isDestroyed()) this.parent.contentView.removeChildView(this.view)
      this.view.setVisible(false)
      if (restoreFocus && !this.parent.isDestroyed()) this.parent.webContents.focus()
    }
    if (previous && !notified) this.notify({ type: 'closed', id: previous.id })
  }

  hidden(sender: WebContents, id: string): void {
    if (sender !== this.view.webContents || this.closing?.id !== id) return
    this.hide(id, this.closing.restoreFocus, true)
  }

  dispose(): void {
    this.disposed = true
    this.hide(undefined, false, true)
    this.page.removeListener('before-mouse-event', this.outsideMouse)
    this.parent.removeListener('resize', this.dismiss)
    if (!this.parent.isDestroyed()) this.parent.contentView.removeChildView(this.view)
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close()
  }
}
