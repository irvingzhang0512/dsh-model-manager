import { type LlmRuntime, type Message, type UserMessage } from '@deepseek-ai/dsh-llm';
import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { ModelManagerService } from './service.js';
import type { ManagedAdapter } from './adapter.js';
import { type ModelRef } from './domain.js';
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'model-manager-vision': {
            kind: 'model-manager-vision';
            form: 'notice';
            summary: string;
            attachmentIds: string[];
            provider: string;
            model: string;
        };
    }
}
export interface VisionDeps {
    llm: LlmRuntime;
    attachments: AttachmentStore;
    service: ModelManagerService;
    adapter?: ManagedAdapter;
}
export interface VisionAnswer {
    answer: string;
    model: ModelRef;
}
export declare function imageRefs(messages: readonly Pick<Message, 'content'>[]): ImageAttachmentRef[];
export declare function analyzeImage(session: string, ref: ImageAttachmentRef, question: string, region: string | undefined, signal: AbortSignal, deps: VisionDeps): Promise<VisionAnswer>;
export declare function visionNotice(ref: ImageAttachmentRef, result: VisionAnswer): UserMessage;
