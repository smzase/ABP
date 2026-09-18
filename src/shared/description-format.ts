import MarkdownIt from 'markdown-it'
import type { PublishSite } from './types.ts'
import { SITE_DESCRIPTION_FORMAT } from './sites.ts'

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: false })

/** Markdown 转 HTML。关闭原始 HTML，避免把任意标签提交到目标站点。 */
export function markdownToHtml(source: string): string {
  return markdown.render(source)
}

type MarkdownToken = ReturnType<(typeof markdown)['parse']>[number]

function renderInline(tokens: MarkdownToken[]): string {
  let out = ''
  for (const token of tokens) {
    switch (token.type) {
      case 'text':
        out += token.content
        break
      case 'code_inline':
        out += `[code]${token.content}[/code]`
        break
      case 'softbreak':
      case 'hardbreak':
        out += '\n'
        break
      case 'strong_open':
        out += '[b]'
        break
      case 'strong_close':
        out += '[/b]'
        break
      case 'em_open':
        out += '[i]'
        break
      case 'em_close':
        out += '[/i]'
        break
      case 's_open':
        out += '[s]'
        break
      case 's_close':
        out += '[/s]'
        break
      case 'link_open':
        out += `[url=${token.attrGet('href') ?? ''}]`
        break
      case 'link_close':
        out += '[/url]'
        break
      case 'image':
        out += `[img]${token.attrGet('src') ?? ''}[/img]`
        break
      case 'html_inline':
        break
      default:
        if (token.children) out += renderInline(token.children)
        else out += token.content
    }
  }
  return out
}

/**
 * 由 markdown-it token 流生成蜜柑可用的 BBCode。解析是结构化的，不依赖易错的
 * 全文正则替换；覆盖标题、粗斜体、删除线、链接、图片、列表、引用和代码块。
 */
export function markdownToBbcode(source: string): string {
  const tokens = markdown.parse(source, {})
  let out = ''
  for (const token of tokens) {
    switch (token.type) {
      case 'inline':
        out += renderInline(token.children ?? [])
        break
      case 'paragraph_close':
        out += '\n\n'
        break
      case 'heading_open': {
        const level = Number(token.tag.slice(1))
        out += `[size=${Math.max(1, 5 - level)}][b]`
        break
      }
      case 'heading_close':
        out += '[/b][/size]\n\n'
        break
      case 'hr':
        out += '[hr]\n\n'
        break
      case 'bullet_list_open':
        out += '[list]\n'
        break
      case 'ordered_list_open':
        out += '[list=1]\n'
        break
      case 'bullet_list_close':
      case 'ordered_list_close':
        out += '[/list]\n\n'
        break
      case 'list_item_open':
        out += '[*]'
        break
      case 'list_item_close':
        out += '\n'
        break
      case 'blockquote_open':
        out += '[quote]'
        break
      case 'blockquote_close':
        out += '[/quote]\n\n'
        break
      case 'fence':
      case 'code_block':
        out += `[code]${token.content.replace(/\n$/, '')}[/code]\n\n`
        break
    }
  }
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

export function formatDescription(site: PublishSite, source: string): string {
  if (site === 'acgrip') return `[markdown]\n\n${source.trim()}\n\n[/markdown]`
  const format = SITE_DESCRIPTION_FORMAT[site]
  if (format === 'html') return markdownToHtml(source)
  if (format === 'bbcode') return markdownToBbcode(source)
  return source
}
