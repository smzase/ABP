import type { Api } from './index.ts'

declare global {
  interface Window {
    api: Api
  }
}

export {}
