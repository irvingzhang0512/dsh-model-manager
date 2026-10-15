import { type GenerateOptions, type LlmFailure, type LlmRuntime, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { type ModelRef } from './domain.js';
export declare const ALIAS_BUFFER_BYTES: number;
export interface AliasRequest {
    request: GenerateOptions;
    route: string;
    restore: (chunk: StreamChunk) => StreamChunk;
    stream?: (request: GenerateOptions) => AsyncIterable<StreamChunk>;
}
export interface AliasLifecycle {
    admit(candidate: ModelRef): Promise<string | undefined>;
    settled(candidate: ModelRef, failure?: LlmFailure): Promise<void>;
    release(): void;
}
export declare function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T>;
export declare function safeFailureMessage(message: string): string;
export declare function caughtFailure(error: unknown): LlmFailure;
/** 每次尝试完整成功后才提交，失败的块与工具调用不会进入宿主。 */
export declare function aliasStream(llm: LlmRuntime, candidates: ModelRef[], signal: AbortSignal, prepare: (candidate: ModelRef, signal: AbortSignal) => Promise<AliasRequest>, log: (event: Record<string, unknown>) => Promise<void>, lifecycle?: AliasLifecycle): AsyncGenerator<StreamChunk>;
export declare function aliasMetadata(llm: LlmRuntime, candidates: ModelRef[], signal?: AbortSignal): Promise<{
    reasoning: {
        efforts: import("@deepseek-ai/dsh-llm").LlmReasoningEffortInfo[];
    } | undefined;
    defaultMaxTokens: undefined;
    context: import("@deepseek-ai/dsh-llm").LlmModelContext | undefined;
    systemPromptUpdate: "in-history" | undefined;
    toolUpdate: import("@deepseek-ai/dsh-llm").ToolUpdate | undefined;
    provider: string;
    id: string;
    name: string;
    description?: string;
    inputModalities?: readonly import("@deepseek-ai/dsh-llm").ModelModality[];
}>;
