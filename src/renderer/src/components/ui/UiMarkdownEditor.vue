<script setup lang="ts">
import { computed } from 'vue'
import { MdEditor } from 'md-editor-v3'
import { useAppStore } from '@renderer/stores/app.ts'
import { setupMarkdownEditor, MD_TOOLBARS, MD_TOOLBARS_COMPACT } from '@renderer/lib/markdown.ts'
import { cn } from '@renderer/lib/utils.ts'

/**
 * Markdown 编辑器统一入口。**不要直接用 md-editor-v3 的 MdEditor**，走这里。
 *
 * 原因：MdEditor 的 highlight / katex / mermaid / echarts / prettier / cropper
 * 扩展在「没有传 instance」时会**现场往 unpkg.com 插 script 标签**
 * （注意：`instance: null` 不能阻止它，反而正是触发条件）。本应用 CSP 是
 * `script-src 'self'`，那些请求会被拦下报错；放开 CSP 也等于每次打开编辑器都外连，
 * 离线不可用。唯一可靠的关法是这些 no* 开关 + 工具栏里不放 fullscreen（screenfull）。
 *
 * 代价：预览区代码块不做语法高亮（仍正常转义显示）、没有公式/图表/格式化/图片裁剪。
 * 发布简介用不上这些。
 */
const props = defineProps<{ compact?: boolean; class?: string }>()
const model = defineModel<string>({ default: '' })

setupMarkdownEditor()

const app = useAppStore()
const theme = computed(() => (app.data.settings.appearance.mode === 'dark' ? 'dark' : 'light'))
const toolbars = computed(() => [...(props.compact ? MD_TOOLBARS_COMPACT : MD_TOOLBARS)])
</script>

<template>
  <MdEditor
    v-model="model"
    :theme="theme"
    :toolbars="toolbars"
    :footers="[]"
    no-highlight
    no-katex
    no-mermaid
    no-echarts
    no-prettier
    no-upload-img
    :class="cn('min-w-0', $props.class)"
  />
</template>
