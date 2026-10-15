import { mapSelectionEffort } from './domain.js';
/** Generic/OpenAI-compatible mapping uses only efforts advertised by DSH. */
export class GenericModelProviderAdapter {
    controls(model) {
        return { thinkingOff: model.reasoningEfforts.some(e => e.id === 'off'), reasoningEfforts: model.reasoningEfforts, independentThinking: false };
    }
    reasoningEffort(model, settings, selection) {
        return mapSelectionEffort(model, settings, selection);
    }
}
export const genericProviderAdapter = new GenericModelProviderAdapter();
