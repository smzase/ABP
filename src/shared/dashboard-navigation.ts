import { ANIBT_WEB_ORIGIN, isAnibtWebUrl } from './anibt-web.ts'

export const DASHBOARD_SECTIONS = ['image-host', 'anime_templates', 'custom_templates', 'sync'] as const
export type DashboardSection = typeof DASHBOARD_SECTIONS[number]
export type DashboardDestination = 'home' | DashboardSection
export type DashboardNavigationAction = 'back' | 'forward' | DashboardDestination

export interface DashboardNavigationState {
  canGoBack: boolean
  canGoForward: boolean
  loggedIn: boolean
  groupSlug: string
  section: DashboardSection | null
}

export function dashboardLocation(url: string): { groupSlug: string; section: DashboardSection | null } {
  if (!isAnibtWebUrl(url)) return { groupSlug: '', section: null }
  const [, root, slug, section] = new URL(url).pathname.split('/')
  // These are site-level group pages, not a group's slug.
  if (root !== 'groups' || !slug || ['new', 'create'].includes(slug)) return { groupSlug: '', section: null }
  return { groupSlug: slug, section: DASHBOARD_SECTIONS.includes(section as DashboardSection) ? section as DashboardSection : null }
}

export function dashboardDestinationUrl(destination: DashboardDestination, groupSlug: string): string {
  if (destination === 'home') return `${ANIBT_WEB_ORIGIN}/groups`
  if (!DASHBOARD_SECTIONS.includes(destination)) throw new Error('Invalid dashboard destination')
  // A slug is taken only from an AniBT group URL, never an email/user id or a local group.
  if (!groupSlug || !/^[\p{L}\p{N}_%.-]+$/u.test(groupSlug) || /^(?:\.|%2e)+$/i.test(groupSlug)) throw new Error('No AniBT group selected')
  return `${ANIBT_WEB_ORIGIN}/groups/${groupSlug}/${destination}`
}
