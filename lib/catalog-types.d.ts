import type { ModelRecord, ModelRef } from './domain.js';
import type { OfficialDiff, OfficialEvidence } from './official-types.js';
import type { HostModel, OfficialState } from './official-state.js';
export interface CatalogCapability {
    providerId: string;
    canAdd: boolean;
    canRename: boolean;
    canRemove: boolean;
    minimumModels: number;
    reason?: string;
}
export type CatalogOperation = {
    kind: 'add';
    model: ModelRef;
    name?: string;
    image?: boolean;
    contextWindow?: number;
    maxTokens?: number;
} | {
    kind: 'rename';
    model: ModelRef;
    name: string;
} | {
    kind: 'remove';
    model: ModelRef;
} | {
    kind: 'removeAlias';
    name: string;
} | {
    kind: 'clearLegacyPreferences';
} | {
    kind: 'clearLegacyImageOverrides';
} | {
    kind: 'clearLegacyAliasReliability';
};
export interface CatalogProfile {
    providerId: string;
    ns: string;
    path: string[];
    models: HostModel[];
    explicit: boolean;
    overrides?: Record<string, Record<string, unknown>>;
    minimumModels: number;
    userFields?: Record<string, string[]>;
    effective?: Record<string, unknown>;
    user?: Record<string, unknown>;
    base?: Record<string, unknown>;
    addConstraints?: {
        missing: string[];
        declared: boolean;
        defaultContextWindow?: number;
        defaultMaxTokens?: number;
    };
}
export interface CatalogState extends OfficialState {
    profiles: CatalogProfile[];
    records: ModelRecord[];
    parameterApis?: Record<string, string>;
    parameterModels?: Record<string, HostModel>;
    legacyImages?: {
        key: string;
        value: unknown;
        exists: true;
    }[];
    legacyAliases?: {
        name: string;
        values: Record<string, unknown>;
    }[];
    rawAliases?: unknown;
}
export interface ModelCatalogIntent {
    id: string;
    kind: 'add' | 'rename' | 'remove' | 'update' | 'migrate' | 'removeAlias';
    model: ModelRef;
    value?: HostModel;
    oldIds?: string[];
    evidence?: OfficialEvidence[];
    officialDiff?: OfficialDiff;
    protectedName?: boolean;
    parameter?: boolean;
    parameterNameBasis?: 'official' | 'knowledge';
}
type CleanupKind = 'clearLegacyPreferences' | 'clearLegacyImageOverrides' | 'clearLegacyAliasReliability';
type CleanupIntent = {
    [K in CleanupKind]: {
        id: string;
        kind: K;
        path: string;
        model?: never;
        officialDiff?: never;
    };
}[CleanupKind];
export type CatalogIntent = ModelCatalogIntent | CleanupIntent;
export interface CatalogOption {
    optionId: string;
    label: string;
    value?: unknown;
    source?: string;
}
export interface CatalogChoice {
    id: string;
    kind: 'replacement' | 'vision' | 'cleanup' | 'parameter' | 'conflict';
    path: string;
    options: CatalogOption[];
    resolution?: string;
}
export interface CatalogReference {
    path: string;
    type: 'usage' | 'attached';
    chain?: string[];
}
interface CatalogDiffFields {
    id: string;
    before: unknown;
    after: unknown;
    references: CatalogReference[];
    attachedSettings: string[];
    conflicts: CatalogChoice[];
    choices: CatalogChoice[];
    blockedReasons: string[];
    evidence?: OfficialEvidence[];
    referenceChanges?: {
        path: string;
        before: unknown;
        after: unknown;
    }[];
}
export type CatalogDiff = CatalogDiffFields & ({
    kind: ModelCatalogIntent['kind'];
    model: ModelRef;
} | {
    kind: CleanupKind;
    path: string;
    model?: never;
});
export interface CatalogResolution {
    id: string;
    optionId: string;
}
export interface CatalogPreview {
    token: string;
    origin: 'manual' | 'official' | 'parameter' | 'source';
    fetchedAt: string;
    operations: CatalogDiff[];
    selected: string[];
    counts: {
        providerId: string;
        before: number;
        after: number;
        operationCount: number;
    }[];
    revisions: Record<string, number | null>;
    catalogFingerprint: string;
    overridesFingerprint: string;
    writesPlugin: boolean;
}
export {};
