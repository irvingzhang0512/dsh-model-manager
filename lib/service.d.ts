import type { LlmRuntime, GenerateOptions } from '@deepseek-ai/dsh-llm';
import type { SettingsProvider } from './desktop-settings.js';
import { type ManagerConfig, type ModelRecord, type ModelRef, type Selection, type Verification } from './domain.js';
import type { AutoDecision } from './auto-router.js';
import { type FutureOverrides } from './official-state.js';
import type { CatalogCapability } from './catalog-types.js';
import { AliasHealthStore } from './alias-health.js';
import type { AliasLifecycle } from './alias-runtime.js';
/**
 * 宿主设置服务拒绝过期 revision 时抛出的冲突错误（`SettingsConflictError`，`code` 固定为 `SETTINGS_CONFLICT`）。
 * 按形状判定而不是 `instanceof`：本插件解析到的是自己那份 `@deepseek-ai/dsh-settings` 拷贝，
 * 与宿主抛出实例的构造函数不同源，`instanceof` 会漏判；错误消息是 `settings namespace "…" changed since it was read (expected …, now …)`。
 */
export declare function isSettingsConflict(error: unknown): boolean;
export interface ModelBridge {
    catalog(): Promise<ModelRecord[]>;
    catalogCapabilities?(): CatalogCapability[];
    applyNative(ref: ModelRef, fields: {
        image?: boolean;
        contextWindow?: number;
        maxTokens?: number;
    }, revision: number): Promise<void>;
    clearNative?(ref: ModelRef, fields: readonly ('image' | 'contextWindow' | 'maxTokens')[], revision: number): Promise<void>;
}
/** 探测时需要精确读写模型的 input 模态声明：读原值、写临时值、按原值恢复（undefined 表示删除该字段）。 */
export interface ModelInputBridge {
    modelInput(ref: ModelRef): readonly string[] | undefined;
    setInput(ref: ModelRef, input: readonly string[] | undefined, revision: number): Promise<void>;
    currentRevision(ref?: ModelRef): number | undefined;
}
export declare class HostModelBridge implements ModelBridge {
    private readonly llm;
    private readonly settings;
    constructor(llm: LlmRuntime, settings: SettingsProvider);
    private namespace;
    catalogCapabilities(): CatalogCapability[];
    catalog(): Promise<ModelRecord[]>;
    applyNative(ref: ModelRef, fields: {
        image?: boolean;
        contextWindow?: number;
        maxTokens?: number;
    }, revision: number): Promise<void>;
    clearNative(ref: ModelRef, fields: readonly ('image' | 'contextWindow' | 'maxTokens')[], revision: number): Promise<void>;
    /** 读取模型当前生效的 input 模态声明：显式清单优先，其次 modelOverrides；undefined 表示未显式声明。 */
    modelInput(ref: ModelRef): readonly string[] | undefined;
    /** 精确设置或删除 input 模态声明；恢复探测前的原值时使用。宿主 revision 可能被提权/还原等并发写入推进，冲突交给 `mutate` 重试。 */
    setInput(ref: ModelRef, input: readonly string[] | undefined, revision: number): Promise<void>;
    /**
     * 写入 `llm-pi-ai` 的唯一入口：宿主 namespace 的 revision 会被并发写入推进
     * （探测提权 → 实测 → 还原就把 revision 推两次），调用方读取的 token 很容易已经过期。
     * 首次仍按调用方 revision 做 CAS；只因冲突失败时改用最新 revision 重试有限次，其他错误立即上抛。
     * 每次尝试都重新执行 `build()`，保证 ops 反映写入时刻的分节（显式模型清单的整表替换尤其如此）。
     */
    private mutate;
    currentRevision(ref?: ModelRef): number | undefined;
}
export declare function resolveDataDir(profile?: string): string;
export declare class ModelManagerService {
    private readonly bridge;
    readonly dataDir: string;
    private readonly settings?;
    readonly health: AliasHealthStore;
    candidateSignature: (ref: ModelRef) => Promise<unknown>;
    tokenEstimate?: (ref: ModelRef, options: GenerateOptions) => number | undefined;
    private aliasTurns;
    private actualModels;
    latestActualModel(session: string): ModelRef | undefined;
    recordActualModel(session: string, ref: ModelRef): void;
    refreshAliasHealth(): Promise<{
        warning?: string | undefined;
        revisionToken: string;
        entries: {
            recovering: boolean;
            alias: string;
            model: ModelRef;
            kind: "transient" | "rate-limit" | "quota" | "auth";
            failedAt: number;
            retryAt?: number;
        }[];
    }>;
    private config;
    private revision;
    private models;
    private writeQueue;
    flush(): Promise<void>;
    private logMaintainedAt;
    private verification;
    private visionCache;
    private overrides;
    private autoDecisions;
    private delegatedSessions;
    private initialization?;
    private catalogBackupId?;
    private catalogBackupWritesPlugin?;
    private parameterBackupId?;
    private sourceBackupId?;
    constructor(bridge: ModelBridge, dataDir: string, settings?: SettingsProvider | undefined);
    aliasCandidateAvailable(alias: string, ref: ModelRef, config: ManagerConfig): Promise<boolean>;
    aliasLifecycle(alias: string, candidates: ModelRef[], config: ManagerConfig, session: string, turn?: number): AliasLifecycle;
    init(): Promise<void>;
    private initialize;
    onCatalogBackup(id: string, origin: string, status: string, writesPlugin: boolean): void;
    snapshot(): {
        revision: number;
        config: ManagerConfig;
        models: ModelRecord[];
        catalogCapabilities: CatalogCapability[];
        catalogBackupId?: string;
        parameterBackupId?: string;
        sourceBackupId?: string;
        legacyImageOverrideCount: number;
        legacyAliasReliabilityCount: number;
        catalogBackupWritesPlugin?: boolean;
        hostDefault?: ModelRef;
        verifications: (Verification & {
            stale: boolean;
        })[];
    };
    refresh(): Promise<ModelRecord[]>;
    private decorateModels;
    update(next: ManagerConfig, revision: number): Promise<number>;
    onSettingsChanged(next: ManagerConfig): void;
    model(ref: ModelRef): ModelRecord | undefined;
    /**
     * 宿主默认模型（`agent-default-model` 设置）。选择器里的 AUTO 条目在没有配置
     * 旧固定主模型未配置时回退到宿主默认，避免 AUTO 落到「没有任何候选」。
     */
    hostDefault(): ModelRef | undefined;
    getOverride(session: string): {
        session?: Selection;
        nextTurn?: Selection;
    };
    setOverride(session: string, scope: 'session' | 'nextTurn', selection?: Selection): Promise<void>;
    futureOverrides(): FutureOverrides;
    futureOverridesFingerprint(): string;
    /** 整个官方写集持有同一覆盖队列；setOverride 和 nextTurn 消耗不能插入其间。 */
    withFutureOverrides<T>(expected: string | undefined, action: (save: (next: FutureOverrides) => Promise<void>) => Promise<T>): Promise<T>;
    effectiveSelection(session: string, turn: number): Selection;
    activeSelection(session: string): Selection | undefined;
    activeTurn(session: string): number | undefined;
    autoDecision(session: string, turn: number): AutoDecision | undefined;
    saveAutoDecision(session: string, turn: number, value: AutoDecision): void;
    latestAutoDecision(session: string): AutoDecision | undefined;
    markDelegatedSession(session: string): void;
    isDelegatedSession(session: string): boolean;
    endTurn(session: string, turn: number): void;
    signature(ref: ModelRef, kind?: Verification['kind']): string;
    verificationKey(ref: ModelRef, kind: Verification['kind']): string;
    getVerification(ref: ModelRef, kind: Verification['kind']): (Verification & {
        stale: boolean;
    }) | undefined;
    getVisionCache(key: string): string | undefined;
    putVisionCache(key: string, answer: string): Promise<void>;
    saveVerification(result: Verification): Promise<void>;
    log(event: Record<string, unknown>): Promise<void>;
    logs(limit?: number): Promise<Record<string, unknown>[]>;
}
