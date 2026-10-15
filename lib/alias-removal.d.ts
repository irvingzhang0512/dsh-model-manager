import { type Selection } from './domain.js';
import type { CatalogChoice, CatalogDiff, CatalogIntent, ModelCatalogIntent, CatalogOption, CatalogState } from './catalog-types.js';
type Choose = (diff: CatalogDiff, suffix: string, kind: CatalogChoice['kind'], path: string, options: CatalogOption[]) => CatalogOption | undefined;
export declare function clearSelectionTarget(selection: Selection): void;
/** 别名是逻辑入口；只删除明确选择的引用，绝不删除候选真实模型。 */
export declare function planAliasRemoval(state: CatalogState, intent: ModelCatalogIntent, intents: CatalogIntent[], choose: Choose): {
    diff: CatalogDiff;
    working: CatalogState;
};
export {};
