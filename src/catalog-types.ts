import type { ModelRecord, ModelRef } from './domain.js'
import type { OfficialDiff, OfficialEvidence } from './official-types.js'
import type { HostModel, OfficialState } from './official-state.js'

export interface CatalogCapability { providerId: string; canAdd: boolean; canRename: boolean; canRemove: boolean; minimumModels: number; reason?: string }
export type CatalogOperation =
  | { kind: 'add'; model: ModelRef; name?: string; image?: boolean; contextWindow?: number; maxTokens?: number }
  | { kind: 'rename'; model: ModelRef; name: string }
  | { kind: 'remove'; model: ModelRef }
export interface CatalogProfile {
  providerId: string; ns: string; path: string[]; models: HostModel[]
  explicit: boolean; overrides?: Record<string, Record<string, unknown>>; minimumModels: number
  userFields?: Record<string, string[]>
  addConstraints?: { missing: string[]; declared: boolean; defaultContextWindow?: number; defaultMaxTokens?: number }
}
export interface CatalogState extends OfficialState { profiles: CatalogProfile[]; records: ModelRecord[] }
export interface CatalogIntent {
  id: string; kind: 'add' | 'rename' | 'remove' | 'update' | 'migrate'; model: ModelRef
  value?: HostModel; oldIds?: string[]; evidence?: OfficialEvidence[]; officialDiff?: OfficialDiff
  protectedName?: boolean
}
export interface CatalogOption { optionId: string; label: string; value?: unknown; source?: string }
export interface CatalogChoice { id: string; kind: 'replacement' | 'vision' | 'cleanup' | 'parameter' | 'conflict'; path: string; options: CatalogOption[]; resolution?: string }
export interface CatalogReference { path: string; type: 'usage' | 'attached'; chain?: string[] }
export interface CatalogDiff {
  id: string; kind: CatalogIntent['kind']; model: ModelRef; before: unknown; after: unknown
  references: CatalogReference[]; attachedSettings: string[]; conflicts: CatalogChoice[]; choices: CatalogChoice[]
  blockedReasons: string[]; evidence?: OfficialEvidence[]
  referenceChanges?: { path: string; before: unknown; after: unknown }[]
}
export interface CatalogResolution { id: string; optionId: string }
export interface CatalogPreview {
  token: string; origin: 'manual' | 'official'; fetchedAt: string; operations: CatalogDiff[]; selected: string[]
  counts: { providerId: string; before: number; after: number; operationCount: number }[]
  revisions: Record<string, number | null>; catalogFingerprint: string; overridesFingerprint: string
  writesPlugin: boolean
}
