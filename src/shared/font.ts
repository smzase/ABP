export const DEFAULT_FONT_STACK = "'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, -apple-system, sans-serif"

/** Quote a single family, including names containing quotes/backslashes. */
export function fontStack(family: string | undefined): string {
  const name = (family ?? '').trim()
  return name ? JSON.stringify(name) + ', ' + DEFAULT_FONT_STACK : DEFAULT_FONT_STACK
}
