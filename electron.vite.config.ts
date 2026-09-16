import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      minify: 'esbuild',
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      minify: 'esbuild',
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') }
      }
    }
  },
  renderer: {
    plugins: [vue(), tailwindcss()],
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
        // md-editor-v3 默认拉全量语法包（~113 个 chunk），这里换成空桩
        '@codemirror/language-data': resolve('src/renderer/src/lib/empty-languages.ts')
      }
    },
    build: {
      minify: 'esbuild',
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') },
        output: {
          // Keep shared Vue code out of lazy editor chunks, otherwise startup imports them too.
          onlyExplicitManualChunks: true,
          manualChunks(id: string) {
            if (id.includes('@codemirror') || id.includes('/codemirror/')) return 'codemirror'
            if (id.includes('md-editor-v3')) return 'md-editor'
          }
        }
      }
    }
  }
})
