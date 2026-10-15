import type { LlmRuntime } from '@deepseek-ai/dsh-llm';
import type { ModelManagerService } from './service.js';
import type { ModelRef, Selection, TaskGrade } from './domain.js';
export declare function recommendAuto(llm: LlmRuntime, service: ModelManagerService, runner: ModelRef | undefined, signal: AbortSignal): Promise<{
    grades: Partial<Record<TaskGrade, Selection>>;
    notes: string[];
}>;
