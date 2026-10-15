import { type CredentialProvider } from '@deepseek-ai/dsh-credentials';
import type { LlmRuntime } from '@deepseek-ai/dsh-llm';
import type { DesktopSettings } from './desktop-settings.js';
import { type ManagerConfig, type SourceConnection } from './domain.js';
import type { CatalogIntent, CatalogPreview, CatalogState } from './catalog-types.js';
import { type HostModel } from './official-state.js';
type Kind = SourceConnection['kind'];
export interface SourceInput {
    kind: Kind;
    providerId?: string;
    sourceId?: string;
    credentialRef?: string;
    arkProfile?: string;
    connection?: Record<string, unknown>;
}
export interface ConnectionChange {
    fieldId: string;
    label: string;
    before?: unknown;
    after: unknown;
    selected: boolean;
}
export interface SourceDescription {
    sourceId: string;
    kind: Kind;
    providerId: string;
    ownerEntryIds: string[];
    credential: {
        ref?: string;
        configured: boolean;
        writable: boolean;
    };
    arkProfile?: string;
    loaded: boolean;
    modelCount: number;
    checkedAt?: string;
    reason?: string;
}
export interface SourcePreview {
    sourceId: string;
    kind: Kind;
    providerId: string;
    fetchedAt: string;
    connectionChanges: ConnectionChange[];
    models: {
        model: {
            providerId: string;
            modelId: string;
        };
        fields: Record<string, unknown>;
        evidence: string[];
    }[];
    catalog: CatalogPreview;
    notes: string[];
}
export interface SourceDraft extends Omit<SourcePreview, 'catalog'> {
    ns?: string;
    path: string[];
    intents: CatalogIntent[];
    selected: string[];
    connection: Record<string, unknown>;
    arkProfile?: string;
}
export interface SourceDeps {
    llm: LlmRuntime;
    settings: DesktopSettings;
    credentials: CredentialProvider;
    config: () => ManagerConfig;
    fetch?: typeof fetch;
    ark?: (args: string[], signal: AbortSignal) => Promise<any>;
    publish?: (draft: SourceDraft, signal: AbortSignal) => Promise<CatalogPreview>;
}
export declare function findArkCli(): Promise<string | undefined>;
export declare function runArk(args: string[], signal: AbortSignal): Promise<any>;
export declare function safeArkStatus(raw: any): {
    loggedIn: boolean;
    profiles: any;
    activeProfile: any;
};
export declare function arkStatus(deps: SourceDeps, signal: AbortSignal): Promise<{
    loggedIn: boolean;
    profiles: any;
    activeProfile: any;
}>;
export declare function describeSources(deps: SourceDeps): Promise<SourceDescription[]>;
export declare function sourceModel(raw: any, kind: Kind): HostModel | undefined;
export declare function prepareSource(input: SourceInput, signal: AbortSignal, deps: SourceDeps): Promise<SourceDraft>;
export declare function previewSource(input: SourceInput, signal: AbortSignal, deps: SourceDeps): Promise<SourcePreview>;
/** Field operations preserve all other model fields; differing existing values start unselected. */
export declare function sourceIntents(draft: SourceDraft, state: CatalogState): SourceDraft;
export {};
