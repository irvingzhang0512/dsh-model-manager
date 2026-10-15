import { LlmAdapter, type GenerateOptions, type LlmModelInfo, type LlmProviderInfo, type LlmResolvedModelInfo, type PreparedAdapterCall, type StreamChunk } from '@deepseek-ai/dsh-llm';
import type { LlmRuntime } from '@deepseek-ai/dsh-llm';
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { ModelManagerService } from './service.js';
export declare const MANAGED_PROVIDER = "dsh-model-manager";
/** 选择器里的 AUTO 条目：托管模式，按 auto.main 决定主模型，没配目标时回退到宿主默认模型。 */
export declare const AUTO_MODEL_ID = "auto";
export declare class VisionRegistry {
    private bySession;
    private introduced;
    add(session: string, refs: ImageAttachmentRef[], turn?: number, refresh?: boolean): void;
    get(session: string, id: string): ImageAttachmentRef | undefined;
    has(session: string, id: string): boolean;
    historical(session: string, ref: ImageAttachmentRef, turn?: number): boolean;
    clear(session: string): void;
}
export declare class ManagedAdapter extends LlmAdapter {
    private readonly llm;
    private readonly service;
    private readonly vision;
    private lifetime;
    private cooldown;
    private pendingAuto;
    constructor(llm: LlmRuntime, service: ModelManagerService, vision: VisionRegistry);
    dispose(): void;
    private frozenStream;
    providerInfo(): LlmProviderInfo;
    providerRetryPolicy(): {
        mode: "normal";
        maxRetries: number;
        retryableCodes: never[];
        initialDelayMs: number;
        maxDelayMs: number;
        jitterRatio: number;
    };
    imageRequestPricing(): undefined;
    /** 内部视觉请求使用自己的别名，不能继承主会话覆盖或再次触发 AUTO。 */
    streamAlias(name: string, options: GenerateOptions, nativeOnly?: boolean, captured?: ReturnType<ModelManagerService['snapshot']>): AsyncIterable<StreamChunk>;
    listModels(): Promise<readonly LlmModelInfo[]>;
    resolveModel(_provider: string, id: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
    prepareCall(provider: string, id: string, signal?: AbortSignal): Promise<PreparedAdapterCall>;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
    private streamWithSnapshot;
    private sidecarMessages;
}
