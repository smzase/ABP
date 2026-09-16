import { reactive } from 'vue'

/**
 * 应用内确认弹窗的状态与入口。
 *
 * **不要用 `window.confirm()`**：它是 Chromium 的原生模态窗口，会把键盘焦点交给系统窗口，
 * 在 Electron 的无边框窗口上关掉之后焦点常常回不到 webContents ——
 * 表现就是「点过一次删除确认，之后所有输入框都打不进字，但还能删」。
 * 而且它长得是系统样式，和 shadcn 那套对不上。
 *
 * 用法：
 * ```ts
 * if (!(await confirm({ title: t('tpl.deleteConfirm') }))) return
 * ```
 */
export interface ConfirmOptions {
  title: string
  description?: string
  /** 确认按钮文案，默认「确认」 */
  confirmText?: string
  cancelText?: string
  /** 破坏性操作（删除）用红色确认按钮 */
  destructive?: boolean
}

interface ConfirmState extends ConfirmOptions {
  open: boolean
  resolve: ((ok: boolean) => void) | null
}

export const confirmState = reactive<ConfirmState>({
  open: false,
  title: '',
  description: '',
  confirmText: '',
  cancelText: '',
  destructive: false,
  resolve: null
})

export function confirm(options: ConfirmOptions): Promise<boolean> {
  // 上一个还开着就先当作取消，避免 resolve 泄漏成永久 pending 的 Promise
  confirmState.resolve?.(false)
  confirmState.title = options.title
  confirmState.description = options.description ?? ''
  confirmState.confirmText = options.confirmText ?? ''
  confirmState.cancelText = options.cancelText ?? ''
  confirmState.destructive = options.destructive ?? false
  confirmState.open = true
  return new Promise<boolean>((resolve) => {
    confirmState.resolve = resolve
  })
}

/**
 * 由 UiConfirmDialog 调用：关窗并结算 Promise。
 * 幂等：先摘掉 resolve 再调用，所以「按钮点击 + 随之而来的 onOpenChange(false)」
 * 这种一次操作触发两次结算的情况，只有第一次算数。
 */
export function settleConfirm(ok: boolean): void {
  const resolve = confirmState.resolve
  if (!resolve) {
    confirmState.open = false
    return
  }
  confirmState.resolve = null
  confirmState.open = false
  resolve(ok)
}
