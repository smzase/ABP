import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { AppData, DashboardBounds, SiteLoginResult } from '@shared/types.ts'
import { defaultAppData } from '@shared/store-doc.ts'
import { toPlain } from '@shared/plain.ts'
import { ACCENT_PRESETS, DEFAULT_ACCENT } from '@shared/constants.ts'
import { i18n } from '@renderer/i18n/index.ts'
import { fontStack } from '@shared/font.ts'
import { initDashboardMenus, updateDashboardMenuSettings } from '@renderer/lib/dashboard-overlay.ts'

/**
 * 根数据 store：整个 AppData 一份，渲染进程深度 watch 防抖落盘。
 * 所有视图都读写这里，避免零散 IPC。
 */
export const useAppStore = defineStore('app', () => {
  const data = ref<AppData>(defaultAppData())
  const loaded = ref(false)
  const webBusy = ref(false)
  const webResult = ref<{ ok: boolean; message: string } | null>(null)

  initDashboardMenus(action => {
    if (action.type === 'theme') setThemeMode(action.value)
    else if (action.type === 'locale') setLocale(action.value)
    else setAccent(action.value)
  })
  watch(() => [data.value.settings.appearance, data.value.settings.locale], () => {
    updateDashboardMenuSettings(toPlain({ appearance: data.value.settings.appearance, locale: data.value.settings.locale }))
  }, { immediate: true, deep: true })

  async function load(): Promise<void> {
    data.value = await window.api.loadStore()
    loaded.value = true
    applyAppearance()
    applyLocale()
    void window.api.setAnibtWebLocale(data.value.settings.locale)
  }

  let timer: ReturnType<typeof setTimeout> | null = null
  watch(
    data,
    () => {
      if (!loaded.value) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        // 响应式对象是 Proxy，结构化克隆不认；toPlain 拍成普通对象再送 IPC
        void window.api.saveStore(toPlain(data.value))
      }, 500)
    },
    { deep: true }
  )

  /** 主题：浅色 #fafafa / 深色 #191a1b；主题色动态写 CSS 变量 */
  function applyAppearance(): void {
    const { mode, accent } = data.value.settings.appearance
    document.documentElement.classList.toggle('dark', mode === 'dark')
    const color = /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : DEFAULT_ACCENT
    document.documentElement.style.setProperty('--primary', color)
    document.documentElement.style.setProperty('--ring', color)
    document.documentElement.style.setProperty('--app-font-family', fontStack(data.value.settings.appearance.fontFamily))
  }

  function applyLocale(): void {
    // 直接操作全局 i18n 实例（此处不在组件 setup 作用域内，不能 useI18n()）
    i18n.global.locale.value = data.value.settings.locale
    document.documentElement.lang = data.value.settings.locale
  }

  function setThemeMode(mode: 'light' | 'dark'): void {
    data.value.settings.appearance.mode = mode
    applyAppearance()
  }

  watch(() => data.value.settings.appearance.mode, mode => {
    void window.api.setAnibtDashboardTheme(mode)
  })

  async function webAction(action: 'login' | 'check' | 'logout' | 'clear', bounds?: DashboardBounds): Promise<void> {
    if (webBusy.value) return
    webBusy.value = true
    webResult.value = null
    try {
      if (action === 'login' || action === 'check') {
        const result: SiteLoginResult = action === 'login'
          ? await window.api.loginAnibtWeb(toPlain(data.value.anibtWebAccount), data.value.settings.appearance.mode, toPlain(bounds!))
          : await window.api.checkAnibtWeb()
        data.value.anibtWebAccount.cookies = result.cookies
        data.value.anibtWebAccount.userAgent = result.userAgent
        webResult.value = { ok: result.ok, message: result.message ?? '' }
      } else {
        await window.api.logoutAnibtWeb(action === 'clear')
        data.value.anibtWebAccount.cookies = []
        webResult.value = { ok: true, message: i18n.global.t(action === 'clear' ? 'webAccount.cleared' : 'webAccount.loggedOut') }
      }
    } catch (error) {
      webResult.value = { ok: false, message: String(error) }
    } finally { webBusy.value = false }
  }

  function setAccent(accent: string): void {
    data.value.settings.appearance.accent = accent
    applyAppearance()
  }

  function setFontFamily(family: string): void {
    data.value.settings.appearance.fontFamily = family
    applyAppearance()
  }

  function setLocale(locale: 'zh-CN' | 'zh-TW' | 'en'): void {
    data.value.settings.locale = locale
    applyLocale()
    void window.api.setAnibtWebLocale(locale)
  }

  return {
    data,
    loaded,
    webBusy,
    webResult,
    webAction,
    load,
    applyAppearance,
    setThemeMode,
    setAccent,
    setFontFamily,
    setLocale,
    accentPresets: ACCENT_PRESETS
  }
})
