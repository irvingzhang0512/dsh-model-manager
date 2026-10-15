import type { LlmRuntime } from '@deepseek-ai/dsh-llm';
import type { ModelRef } from './domain.js';
import type { OfficialAnalysis, OfficialPage, OfficialProgress } from './official-types.js';
export declare function abortableStream<T>(source: AsyncIterable<T>, signal: AbortSignal): AsyncGenerator<T>;
export declare function officialUrl(value: string, hostname?: string): URL;
export declare function extractOfficialPage(html: string, url: string): OfficialPage;
export declare function fetchOfficialPage(source: string, hostname: string, signal: AbortSignal): Promise<OfficialPage>;
export declare function validateOfficialAnalysis(value: unknown, pages: OfficialPage[]): OfficialAnalysis;
export declare function analyzeOfficial(llm: LlmRuntime, analyzer: ModelRef, sourceUrl: string, signal: AbortSignal, progress?: (value: OfficialProgress) => void, requestedEffort?: string, analysisTimeoutSeconds?: number): Promise<{
    analysis: OfficialAnalysis;
    pages: OfficialPage[];
}>;
