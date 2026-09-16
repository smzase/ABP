import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN.ts'
import zhTW from './locales/zh-TW.ts'
import en from './locales/en.ts'

export const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': zhCN,
    'zh-TW': zhTW,
    en
  }
})

export const LOCALE_LABELS: Array<{ value: 'zh-CN' | 'zh-TW' | 'en'; label: string }> = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en', label: 'English' }
]
