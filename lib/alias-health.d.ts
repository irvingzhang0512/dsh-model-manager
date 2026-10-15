import type { LlmFailure } from '@deepseek-ai/dsh-llm';
import { type AliasRecovery, type ModelRef } from './domain.js';
export interface AliasHealthEntry {
    alias: string;
    model: ModelRef;
    signature: string;
    kind: 'transient' | 'rate-limit' | 'quota' | 'auth';
    failedAt: number;
    retryAt?: number;
}
export declare const DEFAULT_RECOVERY: {
    transientCooldownSeconds: number;
    rateLimitCooldownSeconds: number;
    quotaCooldownSeconds: number;
};
export declare function recoveryFailure(failure: LlmFailure): AliasHealthEntry['kind'] | undefined;
export declare class AliasHealthStore {
    private readonly dir;
    private readonly now;
    private leases;
    private tickets;
    private signatures;
    private closed;
    private warning?;
    private primaryValid;
    private state;
    constructor(dir: string, now?: () => number);
    private get file();
    private key;
    init(): Promise<this>;
    private read;
    private change;
    snapshot(): {
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
    };
    retain(valid: Set<string>): Promise<void>;
    eligible(alias: string, model: ModelRef, signature: string): Promise<{
        allowed: boolean;
        reason?: undefined;
    } | {
        allowed: boolean;
        reason: string;
    }>;
    claimRecovery(alias: string, model: ModelRef): string | undefined;
    release(alias: string, model: ModelRef, token?: string): void;
    recordSuccess(alias: string, model: ModelRef, signature: string, token: string): Promise<void>;
    recordFailure(alias: string, model: ModelRef, signature: string, failure: LlmFailure, policy: AliasRecovery, token: string): Promise<void>;
    reset(alias: string, expectedRevisionToken: string): Promise<{
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
    dispose(): void;
}
export declare function openAliasHealthStore(profileDataDir: string): Promise<AliasHealthStore>;
