import type { GenerateOptions, LlmRuntime, LlmImageRequestPricing } from '@deepseek-ai/dsh-llm';
import { type ManagerConfig, type ModelRecord, type ModelRef, type Selection, type TaskGrade, type TaskType, type Verification } from './domain.js';
export interface AutoDecision {
    grade: TaskGrade;
    taskType?: TaskType;
    ruleId?: string;
    reason: string;
    selection: Selection;
    candidates: ModelRef[];
    fallback: boolean;
}
export declare const taskTypes: TaskType[];
export declare function requestInputTokens(options: GenerateOptions, pricing?: LlmImageRequestPricing): number;
export declare function candidateForGrade(config: ManagerConfig, models: ModelRecord[], grade: TaskGrade, options: GenerateOptions, verification?: (ref: ModelRef) => (Verification & {
    stale?: boolean;
}) | undefined): AutoDecision | undefined;
export declare function candidateForTask(config: ManagerConfig, models: ModelRecord[], taskType: TaskType, grade: TaskGrade, options: GenerateOptions, verification?: (ref: ModelRef) => (Verification & {
    stale?: boolean;
}) | undefined, matchRules?: boolean, measure?: (ref: ModelRef) => number | undefined, available?: (ref: ModelRef, selection: Selection) => boolean): AutoDecision | undefined;
export declare function evaluateTask(llm: LlmRuntime, config: ManagerConfig, options: GenerateOptions): Promise<{
    grade: TaskGrade;
    taskType: TaskType;
    reason: string;
    fallback: boolean;
    durationMs: number;
}>;
