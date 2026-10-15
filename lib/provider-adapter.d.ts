import { type ModelRecord, type ModelSettings, type Selection } from './domain.js';
/** Maps manager controls to request fields exposed by a concrete host model. */
export interface ModelProviderAdapter {
    controls(model: ModelRecord): {
        thinkingOff: boolean;
        reasoningEfforts: readonly {
            id: string;
            name: string;
        }[];
        independentThinking: boolean;
    };
    reasoningEffort(model: ModelRecord, settings: ModelSettings | undefined, selection: Selection): string | undefined;
}
/** Generic/OpenAI-compatible mapping uses only efforts advertised by DSH. */
export declare class GenericModelProviderAdapter implements ModelProviderAdapter {
    controls(model: ModelRecord): {
        thinkingOff: boolean;
        reasoningEfforts: {
            id: string;
            name: string;
        }[];
        independentThinking: boolean;
    };
    reasoningEffort(model: ModelRecord, settings: ModelSettings | undefined, selection: Selection): string | undefined;
}
export declare const genericProviderAdapter: ModelProviderAdapter;
