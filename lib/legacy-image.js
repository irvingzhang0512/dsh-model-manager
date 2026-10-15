/** 退役叶字段只保留在原始用户层；有效配置永远不使用它。 */
export function legacyImageOverrides(raw) {
    const models = raw?.models;
    if (!models || typeof models !== 'object' || Array.isArray(models))
        return [];
    return Object.entries(models).flatMap(([key, value]) => {
        const capability = value?.capability;
        return capability && typeof capability === 'object' && Object.hasOwn(capability, 'image') ? [{ key, value: structuredClone(capability.image), exists: true }] : [];
    });
}
export function preserveLegacyImages(next, raw) {
    const models = next?.models;
    for (const item of legacyImageOverrides(raw))
        if (models && Object.hasOwn(models, item.key)) {
            models[item.key].capability ??= {};
            models[item.key].capability.image = structuredClone(item.value);
        }
}
export function cleanLegacyImages(raw) {
    const models = structuredClone(raw?.models ?? {});
    for (const { key } of legacyImageOverrides(raw)) {
        delete models[key].capability.image;
        if (!Object.keys(models[key].capability).length)
            delete models[key].capability;
        if (!Object.keys(models[key]).length)
            delete models[key];
    }
    return models;
}
/** 保存当前已知字段，同时保留 schema／迁移未暴露的原始嵌套字段。 */
export function preserveUnknownConfig(before, next, raw) {
    const object = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
    if (!object(next))
        return structuredClone(next);
    const result = object(raw) ? structuredClone(raw) : {};
    if (object(before))
        for (const key of Object.keys(before))
            if (!Object.hasOwn(next, key))
                delete result[key];
    for (const [key, value] of Object.entries(next)) {
        if (value === undefined)
            delete result[key];
        else
            result[key] = preserveUnknownConfig(object(before) ? before[key] : undefined, value, object(raw) ? raw[key] : undefined);
    }
    return result;
}
