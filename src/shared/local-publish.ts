import type { PublishSite, SitePublishResult } from './types.ts'

/**
 * Run local site publishers one at a time while isolating a rejected request
 * to its own site result. A failed site must not reject the whole IPC call:
 * successful sites still need to be recorded and failed sites remain retryable.
 */
export async function publishSitesSerially(
  sites: readonly PublishSite[],
  publish: (site: PublishSite) => Promise<SitePublishResult>
): Promise<SitePublishResult[]> {
  const results: SitePublishResult[] = []
  for (const site of sites) {
    try {
      results.push(await publish(site))
    } catch (error) {
      results.push({ site, ok: false, error: String(error) })
    }
  }
  return results
}
