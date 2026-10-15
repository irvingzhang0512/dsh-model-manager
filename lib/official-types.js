export const DEFAULT_OFFICIAL_URL = 'https://api-docs.deepseek.com/zh-cn/';
export const OFFICIAL_PROVIDER = 'deepseek-official';
export const DEFAULT_ANALYSIS_TIMEOUT_SECONDS = 180;
export function officialAnalysisTimeout(value = DEFAULT_ANALYSIS_TIMEOUT_SECONDS) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 30 || value > 600)
        throw new Error('每轮分析时限必须是 30–600 的整数秒');
    return value;
}
export function predictedModelCount(preview, selected) {
    const ids = new Set(preview.localModelIds);
    for (const diff of preview.diffs.filter(item => selected.includes(item.id) && !item.blockedReasons.length)) {
        if (diff.field === 'addModel')
            ids.add(diff.modelId);
        if (diff.field === 'removeModel')
            ids.delete(diff.modelId);
        if (diff.field === 'migrateModel') {
            const migration = diff.after;
            migration.oldIds.forEach(id => ids.delete(id));
            ids.add(diff.modelId);
        }
    }
    return ids.size;
}
