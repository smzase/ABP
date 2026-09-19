import MarkdownIt from 'markdown-it'
import type { PublishSite } from './types.ts'
import { SITE_DESCRIPTION_FORMAT } from './sites.ts'

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: false })

/** Markdown 转 HTML。关闭原始 HTML，避免把任意标签提交到目标站点。 */
export function markdownToHtml(source: string): string {
  return markdown.render(source)
}

type MarkdownToken = ReturnType<(typeof markdown)['parse']>[number]

const BLOCK_CLOSE: Record<string, string> = {
  paragraph_open: 'paragraph_close',
  heading_open: 'heading_close',
  bullet_list_open: 'bullet_list_close',
  ordered_list_open: 'ordered_list_close',
  list_item_open: 'list_item_close',
  blockquote_open: 'blockquote_close',
  table_open: 'table_close',
  thead_open: 'thead_close',
  tbody_open: 'tbody_close',
  tr_open: 'tr_close',
  th_open: 'th_close',
  td_open: 'td_close',
}

function findBlockClose(tokens: MarkdownToken[], start: number, end: number): number {
  const closeType = BLOCK_CLOSE[tokens[start]?.type ?? '']
  if (!closeType) return end

  let depth = 0
  for (let index = start; index < end; index += 1) {
    const type = tokens[index].type
    if (type === tokens[start].type) depth += 1
    else if (type === closeType) {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return end
}

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


function renderInlineRange(tokens: MarkdownToken[], start: number, end: number): string {
  return renderInline(tokens.slice(start, end).filter((token) => token.type === 'inline'))
}

type BlockContext = 'root' | 'blockquote' | 'list-item'

function renderListItem(tokens: MarkdownToken[], start: number, end: number): string {
  let out = ''
  let index = start

  while (index < end) {
    const token = tokens[index]
    if (token.type === 'paragraph_open') {
      const close = findBlockClose(tokens, index, end)
      out += renderInlineRange(tokens, index + 1, close)
      index = close + 1
      if (index < end && tokens[index].type === 'paragraph_open') out += '\n\n'
      continue
    }

    if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      const close = findBlockClose(tokens, index, end)
      const nested = renderList(tokens, index, close).trim()
      if (out && !out.endsWith('\n')) out += '\n'
      out += nested
      index = close + 1
      continue
    }

    if (token.type === 'blockquote_open') {
      const close = findBlockClose(tokens, index, end)
      const nested = renderBlocks(tokens, index + 1, close, 'blockquote').trim()
      if (out && !out.endsWith('\n')) out += '\n'
      out += '[quote]' + nested + '[/quote]'
      index = close + 1
      continue
    }

    if (token.type === 'fence' || token.type === 'code_block') {
      out += '[code]' + token.content.replace(/\n$/, '') + '[/code]'
    }
    index += 1
  }

  return out.trim()
}

function renderList(tokens: MarkdownToken[], start: number, end: number): string {
  const ordered = tokens[start].type === 'ordered_list_open'
  const tag = ordered ? 'ol' : 'ul'
  let out = '[' + tag + ']'
  let index = start + 1

  while (index < end) {
    if (tokens[index].type === 'list_item_open') {
      const itemClose = findBlockClose(tokens, index, end)
      const item = renderListItem(tokens, index + 1, itemClose)
      out += '\n[li]' + item + '[/li]'
      index = itemClose + 1
      continue
    }
    index += 1
  }

  return out + '\n[/' + tag + ']\n\n'
}

function renderTable(tokens: MarkdownToken[], start: number, end: number): string {
  let out = '[table]'
  let index = start + 1

  while (index < end) {
    if (tokens[index].type !== 'tr_open') {
      index += 1
      continue
    }

    const rowClose = findBlockClose(tokens, index, end)
    let row = ''
    let cellIndex = index + 1
    while (cellIndex < rowClose) {
      const cell = tokens[cellIndex]
      if (cell.type !== 'th_open' && cell.type !== 'td_open') {
        cellIndex += 1
        continue
      }
      const cellClose = findBlockClose(tokens, cellIndex, rowClose)
      const content = renderInlineRange(tokens, cellIndex + 1, cellClose)
      const tag = cell.type === 'th_open' ? 'th' : 'td'
      row += '[' + tag + ']' + content + '[/' + tag + ']'
      cellIndex = cellClose + 1
    }
    out += '\n[tr]' + row + '[/tr]'
    index = rowClose + 1
  }

  return out + '\n[/table]\n\n'
}

function renderBlocks(tokens: MarkdownToken[], start: number, end: number, context: BlockContext): string {
  let out = ''
  let index = start

  while (index < end) {
    const token = tokens[index]
    switch (token.type) {
      case 'inline':
        out += renderInline(token.children ?? [])
        index += 1
        break
      case 'paragraph_open': {
        const close = findBlockClose(tokens, index, end)
        out += renderInlineRange(tokens, index + 1, close)
        out += context === 'list-item' ? '\n' : '\n\n'
        index = close + 1
        break
      }
      case 'heading_open': {
        const close = findBlockClose(tokens, index, end)
        const level = Number(token.tag.slice(1))
        out += '[size=' + Math.max(1, 5 - level) + '][b]' + renderInlineRange(tokens, index + 1, close) + '[/b][/size]\n\n'
        index = close + 1
        break
      }
      case 'hr':
        out += '[hr]\n\n'
        index += 1
        break
      case 'bullet_list_open':
      case 'ordered_list_open': {
        const close = findBlockClose(tokens, index, end)
        out += renderList(tokens, index, close)
        index = close + 1
        break
      }
      case 'blockquote_open': {
        const close = findBlockClose(tokens, index, end)
        const inner = renderBlocks(tokens, index + 1, close, 'blockquote').trim()
        out += '[quote]' + inner + '[/quote]\n\n'
        index = close + 1
        break
      }
      case 'table_open': {
        const close = findBlockClose(tokens, index, end)
        out += renderTable(tokens, index, close)
        index = close + 1
        break
      }
      case 'fence':
      case 'code_block':
        out += '[code]' + token.content.replace(/\n$/, '') + '[/code]\n\n'
        index += 1
        break
      default:
        index += 1
        break
    }
  }

  return out
}

/**
 * 由 markdown-it token 流生成蜜柑可用的 BBCode。解析是结构化的，不依赖易错的
 * 全文正则替换；覆盖标题、粗斜体、删除线、链接、图片、列表、表格、引用和代码块。
 */
export function markdownToBbcode(source: string): string {
  const tokens = markdown.parse(source, {})
  return renderBlocks(tokens, 0, tokens.length, 'root').replace(/\n{3,}/g, '\n\n').trim()
}

export function formatDescription(site: PublishSite, source: string): string {
  if (site === 'acgrip') return `[markdown]\n\n${source.trim()}\n\n[/markdown]`
  const format = SITE_DESCRIPTION_FORMAT[site]
  if (format === 'html') return markdownToHtml(source)
  if (format === 'bbcode') return markdownToBbcode(source)
  return source
}
