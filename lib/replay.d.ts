import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { ModelRef } from './domain.js';
export declare function wrapReplay(chunk: StreamChunk, ref: ModelRef): StreamChunk;
export declare function unwrapReplay(messages: GenerateOptions['messages']): GenerateOptions['messages'];
