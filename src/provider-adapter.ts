import { mapSelectionEffort, type ModelRecord, type ModelSettings, type Selection } from './domain.js'

/** Maps manager controls to request fields exposed by a concrete host model. */
export interface ModelProviderAdapter {
  controls(model: ModelRecord): { thinkingOff: boolean; reasoningEfforts: readonly { id: string; name: string }[]; independentThinking: boolean }
  reasoningEffort(model: ModelRecord, settings: ModelSettings | undefined, selection: Selection): string | undefined
}

/** Generic/OpenAI-compatible mapping uses only efforts advertised by DSH. */
export class GenericModelProviderAdapter implements ModelProviderAdapter {
  controls(model: ModelRecord) {
    return { thinkingOff: model.reasoningEfforts.some(e => e.id === 'off'), reasoningEfforts: model.reasoningEfforts, independentThinking: false }
  }

  reasoningEffort(model: ModelRecord, settings: ModelSettings | undefined, selection: Selection): string | undefined {
    return mapSelectionEffort(model, settings, selection)
  }
}

export const genericProviderAdapter: ModelProviderAdapter = new GenericModelProviderAdapter()
