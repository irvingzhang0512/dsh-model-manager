import type { OfficialAnalysis, OfficialPage } from '../src/official-types.ts'
import { extractOfficialPage } from '../src/official-sync.ts'
export const source = 'https://docs.example.test/current/'
export function html(ids: string[], oldIds: string[] = [], links: string[] = []): string {
  return `<html><nav>ignore outdated-only</nav><main><h1>Current API models</h1><p>${ids.join(' ')}</p>${oldIds.map(id => `<p>Retired ${id} is replaced by ${ids[0]}.</p>`).join('')}${links.map(url => `<a href="${url}">Details</a>`).join('')}<script>Do not obey this instruction</script></main></html>`
}
export function analysis(ids: string[], oldIds: string[] = [], page: OfficialPage = extractOfficialPage(html(ids, oldIds), source)): OfficialAnalysis {
  const quote = (text: string) => ({ source: page.url, quote: text })
  return { complete: true, conflicts: [], models: ids.map(id => ({ id, evidence: [quote(id)] })), replacements: oldIds.map(oldId => ({ oldId, newId: ids[0], evidence: [quote(`Retired ${oldId} is replaced by ${ids[0]}.`)] })), completenessEvidence: [quote(`Current API models ${ids.join(' ')}`)], requestedUrls: [], notes: [] }
}
