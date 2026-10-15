import { type ToolRuntime } from '@deepseek-ai/dsh-tools';
import type { VisionRegistry } from './adapter.js';
import { type VisionDeps } from './vision-analysis.js';
export declare function registerManagerTools(deps: VisionDeps & {
    tools: ToolRuntime;
    vision: VisionRegistry;
}): () => void;
