/** 退役叶字段只保留在原始用户层；有效配置永远不使用它。 */
export declare function legacyImageOverrides(raw: unknown): {
    key: string;
    value: unknown;
    exists: true;
}[];
export declare function preserveLegacyImages(next: unknown, raw: unknown): void;
export declare function cleanLegacyImages(raw: unknown): unknown;
/** 保存当前已知字段，同时保留 schema／迁移未暴露的原始嵌套字段。 */
export declare function preserveUnknownConfig(before: unknown, next: unknown, raw: unknown): any;
