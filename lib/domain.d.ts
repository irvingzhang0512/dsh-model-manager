export type Support = 'yes' | 'no' | 'unknown';
export type Tier = 'auto' | 'off' | 'low' | 'high' | 'max' | 'fast' | 'balanced' | 'deep';
export type TaskGrade = 'simple' | 'normal' | 'complex';
export type TaskType = 'coding' | 'writing' | 'research' | 'analysis' | 'general';
export interface AliasRecovery {
    transientCooldownSeconds?: number;
    rateLimitCooldownSeconds?: number;
    quotaCooldownSeconds?: number;
}
export interface SourceConnection {
    kind: 'deepseek' | 'ark-agent-plan' | 'opencode-go';
    providerId: string;
    arkProfile?: string;
}
export interface AutoRule {
    id: string;
    name: string;
    enabled: boolean;
    taskTypes: TaskType[];
    grades?: TaskGrade[];
    selection: Selection;
}
export type VisionPolicy = 'native-first' | 'sidecar-first' | 'native-only' | 'sidecar-only';
export type Role = 'search' | 'coding' | 'review' | 'strong' | 'vision';
export interface ModelRef {
    providerId: string;
    modelId: string;
}
export interface CapabilityOverride {
    thinking?: Support;
    contextWindow?: number;
    maxOutputTokens?: number;
    source?: string;
}
export interface ModelSettings {
    capability?: CapabilityOverride;
    /** 档位映射：low/high/max 取值为该模型支持的实际档位 id；缺省或 'auto' 表示按模型公开档位自动推断；off 直接使用模型的关闭思考档位。 */
    tiers?: Partial<Record<'low' | 'high' | 'max', string>>;
    /** 从旧版保留，确保原 fast/balanced/deep 选择的实际档位不丢失。 */
    legacyTiers?: Partial<Record<'fast' | 'balanced' | 'deep', string>>;
}
export interface Selection {
    target?: ModelRef | string;
    /** v1/v2 迁移兼容；新设置只使用 reasoningEffort。 */
    thinking?: 'inherit' | 'auto' | 'off';
    tier?: Tier | 'inherit';
    reasoningEffort?: string;
    maxOutputTokens?: number;
}
/** 子 Agent 角色绑定：是否可委派由「角色是否绑定了有效模型」决定，这里只负责绑模型与推理参数。 */
export interface RoleSettings extends Selection {
}
/** 别名级兜底覆盖：未填写的字段使用全局默认兜底策略。 */
export interface AliasReliability {
    maxAttempts?: number;
    retryTransient?: boolean;
    parameterDowngrade?: boolean;
}
/** 别名 = 一串按顺序兜底的具体模型候选 + 可选的兜底策略覆盖。 */
export interface AliasConfig {
    candidates: ModelRef[];
    efforts?: Record<string, string>;
    reliability?: AliasReliability;
    recovery?: AliasRecovery;
}
export interface ManagerConfig {
    version: 4;
    sources?: Record<string, SourceConnection>;
    catalogMetadata?: Record<string, {
        origin?: 'manual' | 'official' | 'source';
        customName?: boolean;
        [key: string]: unknown;
    }>;
    aliases: Record<string, AliasConfig>;
    models: Record<string, ModelSettings>;
    official?: {
        sourceUrl?: string;
        analyzer?: ModelRef;
        checkedAt?: string;
        sources?: Record<string, string>;
    };
    parameterCompletion?: {
        searchCredentialName?: string;
        [key: string]: unknown;
    };
    /** main/roles 仅供旧配置迁移和已有会话读取。 */
    auto: {
        enabled: boolean;
        evaluator?: ModelRef;
        evaluatorReasoningEffort?: string;
        rules?: AutoRule[];
        simple: Selection;
        normal: Selection;
        complex: Selection;
        preferences?: Record<string, Selection>;
        main: Selection;
        roles: Record<Role, RoleSettings>;
    };
    vision: {
        enabled: boolean;
        policy: VisionPolicy;
        target?: ModelRef | string;
        automatic?: boolean;
    };
    /** 全局默认兜底策略；别名可用 reliability 覆盖个别字段。 */
    reliability: {
        maxAttempts: number;
        retryTransient: boolean;
        parameterDowngrade: boolean;
    };
}
export interface ModelRecord extends ModelRef {
    name: string;
    nativeImage: Support;
    reasoningEfforts: {
        id: string;
        name: string;
    }[];
    defaultReasoningEffort?: string;
    nativeDeclaration?: 'saved' | 'default';
    contextWindow?: number;
    defaultMaxTokens?: number;
    source: 'host' | 'user';
    loaded: boolean;
    nativeEditable?: boolean;
    nativeRevision?: number;
    nativeClearable?: boolean;
    nativeEditReason?: string;
    capabilitySource?: string;
    capabilityCheckedAt?: string;
    catalogOrigin?: 'manual' | 'official' | 'source' | 'unknown';
    customName?: boolean;
}
export interface Verification {
    model: ModelRef;
    kind: 'text' | 'image' | 'tools' | 'reasoning';
    status: 'accepted' | 'rejected' | 'network-error' | 'cancelled';
    checkedAt: string;
    signature: string;
    requestCount: number;
    behavior?: 'observed' | 'not-observed' | 'unknown';
    detail?: string;
}
/** 上下文溢出兜底使用的内置保留别名。 */
export declare const LONG_CONTEXT_ALIAS = "long-context";
/** 探测建议只写宿主原生声明。 */
export type ProbeField = 'hostImage';
export interface ProbeSuggestion {
    field: ProbeField;
    value: Support;
    confidence: 'high' | 'low';
    reason: string;
}
/**
 * 把探测得到的验证证据映射成可预览的配置建议。
 * 只依据行为证据：识别出探测图颜色才算高置信；
 * 网络错误、取消、请求被拒一律不给建议，避免把偶发故障写成模型能力。
 */
export declare function probeSuggestions(verifications: Verification[]): ProbeSuggestion[];
export declare const DEFAULT_CONFIG: ManagerConfig;
export declare function modelKey(ref: ModelRef): string;
export declare function managedId(ref: ModelRef): string;
export declare function fromManagedId(id: string): ModelRef;
export declare function aliasCandidates(config: ManagerConfig, name: string): ModelRef[];
export declare function resolveSelection(config: ManagerConfig, target?: ModelRef | string): ModelRef[];
/**
 * 按模型公开的实际档位推断 low/high/max 的默认映射：
 * low → 最弱档、max → 最强档、high → 次强档（档位不足三个时与 max 重合）。
 * off 不推断：直接使用模型的关闭思考档位。零配置默认值；推断错时用户仍可逐模型显式覆盖。
 */
export declare function inferTierMapping(record: ModelRecord): Partial<Record<'low' | 'high' | 'max', string>>;
export declare function mapEffort(record: ModelRecord, settings: ModelSettings | undefined, tier: Tier | 'inherit' | undefined): string | undefined;
/** 兼容旧调用点：off 语义已并入 tier，这里只按 tier 解析。 */
export declare function mapSelectionEffort(record: ModelRecord, settings: ModelSettings | undefined, selection: Selection): string | undefined;
export declare function mergeSelection(base: Selection, overlay?: Selection): Selection;
/** 把 v1 配置迁移成 v2：别名数组包成 AliasConfig，长上下文候选转成内置别名，丢弃 mode/manual 行；新旧档位名统一对齐（幂等）。 */
export declare function migrateConfig(input: unknown): ManagerConfig;
export declare function validateConfig(config: ManagerConfig): void;
export declare function visionRoute(policy: VisionPolicy, nativeImage: Support, hasSidecar: boolean): 'native' | 'sidecar' | 'error';
export declare function classifyFailure(status?: number, code?: string): 'retry' | 'cooldown' | 'auth' | 'context' | 'parameter' | 'terminal';
