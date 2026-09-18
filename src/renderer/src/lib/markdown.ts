import { config } from 'md-editor-v3'
import { lineNumbers, highlightActiveLineGutter } from '@codemirror/view'
import 'md-editor-v3/lib/style.css'

let applied = false

/**
 * md-editor-v3 全局配置，幂等：给源码编辑区补行号槽、把预览渲染延迟调到实时。
 * md-editor-v3 默认扩展里已有 EditorView.lineWrapping（横向自动换行），不用重复加。
 *
 * renderDelay 默认 500ms（见 md-editor-v3/lib/es/chunks/config.mjs），
 * 表现就是「打完字右边预览要等半秒才动」。本应用的简介都是短文本，
 * 没有性能顾虑，直接设 0 做到边打边渲染。
 *
 * 外部 CDN 的关闭不在这里 —— 那是 MdEditor 的 no* props，见
 * components/ui/UiMarkdownEditor.vue。`editorExtensions.*.instance = null`
 * 不但关不掉，反而正是触发 CDN 注入的条件。
 */
export function setupMarkdownEditor(): void {
  if (applied) return
  applied = true
  config({
    editorConfig: {
      renderDelay: 0
    },
    codeMirrorExtensions(extensions) {
      return [
        // md-editor-v3 默认把超过 30 字符的链接替换成可点击的 “...”。
        // 这不是 CSS 省略，所以必须移除 CodeMirror 的内置替换扩展。
        ...extensions.filter((item) => item.type !== 'linkShortener'),
        { type: 'lineNumbers', extension: lineNumbers() },
        { type: 'highlightActiveLineGutter', extension: highlightActiveLineGutter() }
      ]
    }
  })
}

/**
 * 统一工具栏：只留不依赖外部 CDN 的按钮。
 * 剔除了 fullscreen（screenfull）、prettier、katex、mermaid、image（无上传通道）、save、github。
 */
export const MD_TOOLBARS = [
  'bold',
  'italic',
  'strikeThrough',
  'title',
  '-',
  'quote',
  'unorderedList',
  'orderedList',
  'task',
  '-',
  'codeRow',
  'code',
  'link',
  'table',
  '-',
  'revoke',
  'next',
  '=',
  'pageFullscreen',
  'preview',
  'previewOnly',
  'catalog'
] as const

/** 发布行里的简介编辑器更窄，给一套精简工具栏 */
export const MD_TOOLBARS_COMPACT = [
  'bold',
  'italic',
  '-',
  'quote',
  'unorderedList',
  'orderedList',
  '-',
  'codeRow',
  'code',
  'link',
  '-',
  'revoke',
  'next',
  '=',
  'preview'
] as const
