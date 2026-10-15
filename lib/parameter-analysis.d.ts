import type { LlmRuntime } from '@deepseek-ai/dsh-llm';
import type { ModelRef } from './domain.js';
import { type OfficialPage } from './official-types.js';
import { type ModelParameterTarget, type ParameterAnalysis } from './model-parameters.js';
export interface ParameterProgress {
    stage: 'searching' | 'reading' | 'analyzing' | 'planning';
    model?: ModelRef;
    modelIndex: number;
    modelCount: number;
    searchCount: number;
    analysisCount: number;
    round?: number;
    analysisStartedAt?: string;
    analysisTimeoutSeconds?: number;
}
export interface ParameterSearch {
    search(query: string, signal: AbortSignal): Promise<{
        title: string;
        url: string;
        summary?: string;
    }[]>;
    read(url: string, signal: AbortSignal): Promise<OfficialPage>;
    officialHosts(target: ModelParameterTarget): string[];
}
export declare function platformOfficialHosts(provider: string, baseHostname?: string): string[];
export declare function publicAddress(address: string): boolean;
export declare function readParameterPage(source: string, signal: AbortSignal): Promise<OfficialPage>;
export declare function createParameterSearch(resolveKey: () => Promise<string>, hosts: (target: ModelParameterTarget) => string[]): ParameterSearch;
export declare function analyzeModelParameters(llm: LlmRuntime, search: ParameterSearch, targets: ModelParameterTarget[], options: {
    analyzer: ModelRef;
    reasoningEffort?: string;
    analysisTimeoutSeconds: number;
}, signal: AbortSignal, progress?: (value: ParameterProgress) => void): Promise<ParameterAnalysis>;
