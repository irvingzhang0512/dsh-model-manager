import type { ModelRef } from './domain.js';
import type { CatalogPreview } from './catalog-types.js';
export declare const DEFAULT_OFFICIAL_URL = "https://api-docs.deepseek.com/zh-cn/";
export declare const OFFICIAL_PROVIDER = "deepseek-official";
export declare const DEFAULT_ANALYSIS_TIMEOUT_SECONDS = 180;
export declare function officialAnalysisTimeout(value?: unknown): number;
export interface OfficialEvidence {
    source: string;
    quote: string;
}
export interface OfficialModel {
    id: string;
    name?: string;
    image?: boolean;
    contextWindow?: number;
    efforts?: string[];
    evidence: OfficialEvidence[];
    propertyEvidence?: Partial<Record<'name' | 'image' | 'contextWindow' | 'efforts', OfficialEvidence[]>>;
}
export interface OfficialReplacement {
    oldId: string;
    newId: string;
    evidence: OfficialEvidence[];
}
export interface OfficialAnalysis {
    complete: boolean;
    conflicts: string[];
    models: OfficialModel[];
    replacements: OfficialReplacement[];
    completenessEvidence: OfficialEvidence[];
    requestedUrls: string[];
    notes: string[];
}
export interface OfficialPage {
    url: string;
    fetchedAt: string;
    text: string;
    links: string[];
}
export interface OfficialProgress {
    stage: 'reading' | 'analyzing' | 'diffing';
    round: number;
    pageCount: number;
    analysisStartedAt?: string;
    analysisTimeoutSeconds?: number;
}
export interface OfficialDiff {
    id: string;
    modelId: string;
    field: 'name' | 'inputModalities' | 'contextWindow' | 'addModel' | 'migrateModel' | 'removeModel';
    before: unknown;
    after: unknown;
    evidence: OfficialEvidence[];
    reason: string;
    references: string[];
    blockedReasons: string[];
}
export interface OfficialPreview {
    catalog?: CatalogPreview;
    token: string;
    sourceUrl: string;
    analyzer: ModelRef;
    reasoningEffort?: string;
    analysisTimeoutSeconds: number;
    fetchedAt: string;
    pages: {
        url: string;
        fetchedAt: string;
    }[];
    analysis: OfficialAnalysis;
    diffs: OfficialDiff[];
    notes: string[];
    revisions: Record<string, number | null>;
    overridesFingerprint: string;
    localModelIds: string[];
}
export declare function predictedModelCount(preview: OfficialPreview, selected: string[]): number;
