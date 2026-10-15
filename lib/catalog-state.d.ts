import { type ModelRef } from './domain.js';
import { type OfficialAnalysis } from './official-types.js';
import type { CatalogDiff, CatalogIntent, ModelCatalogIntent, CatalogReference, CatalogResolution, CatalogState } from './catalog-types.js';
export declare function manualIntents(input: unknown, state: CatalogState): CatalogIntent[];
export declare function catalogReferences(state: CatalogState, models: ModelRef[]): CatalogReference[];
export declare function officialIntents(state: CatalogState, analysis: OfficialAnalysis): ModelCatalogIntent[];
export declare function planCatalog(before: CatalogState, intents: CatalogIntent[], resolutions?: CatalogResolution[], selected?: string[]): {
    operations: CatalogDiff[];
    after: CatalogState;
};
