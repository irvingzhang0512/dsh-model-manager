import type { ModelRef } from './domain.js'
export const DEFAULT_OFFICIAL_URL = 'https://api-docs.deepseek.com/zh-cn/'
export const OFFICIAL_PROVIDER = 'deepseek-official'
export interface OfficialEvidence { source: string; quote: string }
export interface OfficialModel {
  id: string; name?: string; image?: boolean; contextWindow?: number; efforts?: string[]
  evidence: OfficialEvidence[]
  propertyEvidence?: Partial<Record<'name' | 'image' | 'contextWindow' | 'efforts', OfficialEvidence[]>>
}
export interface OfficialReplacement { oldId: string; newId: string; evidence: OfficialEvidence[] }
export interface OfficialAnalysis {
  complete: boolean; conflicts: string[]; models: OfficialModel[]; replacements: OfficialReplacement[]
  completenessEvidence: OfficialEvidence[]; requestedUrls: string[]; notes: string[]
}
export interface OfficialPage { url: string; fetchedAt: string; text: string; links: string[] }
export interface OfficialProgress { stage: 'reading' | 'analyzing' | 'diffing'; round: number; pageCount: number }
export interface OfficialDiff {
  id: string; modelId: string
  field: 'name' | 'inputModalities' | 'contextWindow' | 'addModel' | 'migrateModel' | 'removeModel'
  before: unknown; after: unknown; evidence: OfficialEvidence[]; reason: string
  references: string[]; blockedReasons: string[]
}
export interface OfficialPreview {
  token: string; sourceUrl: string; analyzer: ModelRef; reasoningEffort?: string; fetchedAt: string
  pages: { url: string; fetchedAt: string }[]; analysis: OfficialAnalysis; diffs: OfficialDiff[]; notes: string[]
  revisions: Record<string, number | null>; overridesFingerprint: string; localModelIds: string[]
}
export function predictedModelCount(preview: OfficialPreview, selected: string[]): number {
  const ids = new Set(preview.localModelIds)
  for (const diff of preview.diffs.filter(item => selected.includes(item.id) && !item.blockedReasons.length)) {
    if (diff.field === 'addModel') ids.add(diff.modelId)
    if (diff.field === 'removeModel') ids.delete(diff.modelId)
    if (diff.field === 'migrateModel') {
      const migration = diff.after as { oldIds: string[] }
      migration.oldIds.forEach(id => ids.delete(id)); ids.add(diff.modelId)
    }
  }
  return ids.size
}
