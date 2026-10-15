import { type ManagerConfig, type Selection } from './domain.js';
import { type OfficialAnalysis, type OfficialDiff } from './official-types.js';
export type FutureOverrides = Record<string, {
    session?: Selection;
    nextTurn?: Selection;
}>;
export type HostModel = {
    id: string;
    name?: string;
    contextWindow?: number;
    inputModalities?: string[];
    [key: string]: unknown;
};
export interface OfficialState {
    models: HostModel[];
    config: ManagerConfig;
    defaultModel?: Record<string, unknown>;
    subagents?: {
        allowedModels?: {
            provider: string;
            model: string;
            [key: string]: unknown;
        }[];
        [key: string]: unknown;
    };
    overrides: FutureOverrides;
}
export declare function canonical(value: unknown): string;
export declare function officialReferences(state: OfficialState, id: string): string[];
export declare function officialDiffs(state: OfficialState, analysis: OfficialAnalysis): OfficialDiff[];
export declare function applyOfficialDiffs(state: OfficialState, diffs: OfficialDiff[]): OfficialState;
