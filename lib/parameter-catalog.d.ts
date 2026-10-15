import type { CatalogState } from './catalog-types.js';
import type { HostParameterCatalog } from './model-parameters.js';
/** 使用与宿主适配器相同的已安装公开目录 API；失败保守标 unknown。 */
export declare function readParameterCatalog(state: CatalogState): Promise<HostParameterCatalog>;
