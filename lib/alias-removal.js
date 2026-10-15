import { mapSelectionEffort, modelKey, validateConfig } from './domain.js';
import { canonical } from './official-state.js';
export function clearSelectionTarget(selection) {
    delete selection.target;
    delete selection.reasoningEffort;
    delete selection.tier;
    delete selection.thinking;
}
/** 别名是逻辑入口；只删除明确选择的引用，绝不删除候选真实模型。 */
export function planAliasRemoval(state, intent, intents, choose) {
    const name = intent.model.modelId.slice('alias:'.length), alias = `@${name}`, working = structuredClone(state);
    const diff = { id: intent.id, kind: 'removeAlias', model: intent.model, before: structuredClone(state.config.aliases[name]), after: null, references: [], attachedSettings: [], conflicts: [], choices: [], blockedReasons: [] };
    const records = working.records.filter(record => record.providerId !== 'dsh-model-manager' && record.loaded && !intents.some(i => i.kind === 'remove' && modelKey(i.model) === modelKey(record)));
    const options = (image = false) => records.filter(record => !image || record.nativeImage === 'yes').map(record => ({ optionId: modelKey(record), label: `${record.name} · ${record.providerId}`, value: { providerId: record.providerId, modelId: record.modelId } }));
    const parameter = (selection, ref, path) => {
        const record = records.find(record => modelKey(record) === modelKey(ref));
        try {
            mapSelectionEffort(record, working.config.models[modelKey(ref)], selection);
            return;
        }
        catch { }
        const picked = choose(diff, `parameter:${path}`, 'parameter', `${path} 推理参数`, [{ optionId: 'default', label: '使用目标模型默认（清除旧档位）' }, ...record.reasoningEfforts.map(e => ({ optionId: e.id, label: e.name, value: e.id }))]);
        if (!picked)
            diff.blockedReasons.push(`替代模型不支持旧推理档位：${path}`);
        else {
            delete selection.reasoningEffort;
            delete selection.tier;
            delete selection.thinking;
            if (picked.value !== undefined)
                selection.reasoningEffort = picked.value;
        }
    };
    const ordinary = (selection, path, required = false) => {
        if (selection.target !== alias)
            return;
        diff.references.push({ path: `${path}.target`, type: 'usage', chain: [`${path}.target`, alias] });
        const picked = choose(diff, `reference:${path}`, 'replacement', `${path}.target`, [...(!required ? [{ optionId: 'clear', label: path === 'auto.main' ? '清除旧主模型绑定（旧 AUTO 使用宿主默认模型）' : '清除该引用及依赖目标的推理档位' }] : []), ...options()]);
        if (!picked) {
            diff.blockedReasons.push(`请处理别名引用：${path}.target`);
            return;
        }
        if (picked.optionId === 'clear')
            clearSelectionTarget(selection);
        else {
            selection.target = structuredClone(picked.value);
            parameter(selection, selection.target, path);
        }
    };
    for (const grade of ['main', 'simple', 'normal', 'complex'])
        ordinary(working.config.auto[grade], `auto.${grade}`, grade !== 'main' && working.config.auto.enabled);
    for (const [index, rule] of (working.config.auto.rules ?? []).entries())
        ordinary(rule.selection, `auto.rules[${index}].selection`, working.config.auto.enabled && rule.enabled);
    for (const [key, selection] of Object.entries(working.config.auto.roles))
        if (key !== 'vision')
            ordinary(selection, `auto.roles.${key}`);
    for (const [session, override] of Object.entries(working.overrides))
        for (const scope of ['session', 'nextTurn'])
            if (override[scope])
                ordinary(override[scope], `overrides.${session}.${scope}`);
    // 两个图片目标分别处理，关闭当前辅助可整体清除同别名兜底；无关当前辅助不受影响。
    const visuals = [
        { path: 'vision.target', get: () => working.config.vision.target, clear: () => { delete working.config.vision.target; }, replace: (ref) => { working.config.vision.target = ref; } },
        { path: 'auto.roles.vision.target', get: () => working.config.auto.roles.vision.target, clear: () => clearSelectionTarget(working.config.auto.roles.vision), replace: (ref) => { working.config.auto.roles.vision.target = ref; parameter(working.config.auto.roles.vision, ref, 'auto.roles.vision'); } },
    ];
    for (const visual of visuals)
        if (visual.get() === alias)
            diff.references.push({ path: visual.path, type: 'usage', chain: [visual.path, alias] });
    for (const visual of visuals) {
        if (visual.get() !== alias)
            continue;
        const active = working.config.vision.enabled && (visual.path === 'vision.target' || !working.config.vision.target);
        const picked = choose(diff, `vision:${visual.path}`, 'vision', visual.path, [active ? { optionId: 'disable', label: '关闭视觉辅助并清除该别名的图片目标' } : { optionId: 'clear', label: '清除该遗留图片引用（保留无关当前辅助）' }, ...options(true)]);
        if (!picked)
            diff.blockedReasons.push(`请处理图片别名引用：${visual.path}`);
        else if (picked.optionId === 'disable') {
            working.config.vision.enabled = false;
            for (const item of visuals)
                if (item.get() === alias)
                    item.clear();
        }
        else if (picked.optionId === 'clear')
            visual.clear();
        else
            visual.replace(structuredClone(picked.value));
    }
    const logical = (provider, model) => provider === 'dsh-model-manager' && model === intent.model.modelId;
    if (logical(working.defaultModel?.provider, working.defaultModel?.model)) {
        const path = 'agent-default-model.model';
        diff.references.push({ path, type: 'usage', chain: [path, alias] });
        const picked = choose(diff, `reference:${path}`, 'replacement', path, options());
        if (!picked)
            diff.blockedReasons.push('宿主默认模型必须替换为真实模型');
        else {
            const ref = picked.value;
            working.defaultModel.provider = ref.providerId;
            working.defaultModel.model = ref.modelId;
        }
    }
    const entries = working.subagents?.allowedModels ?? [], kept = [];
    entries.forEach((entry, index) => {
        if (!logical(entry.provider, entry.model)) {
            kept.push(entry);
            return;
        }
        const path = `subagent-model-selection.allowedModels[${index}]`;
        diff.references.push({ path, type: 'usage', chain: [path, alias] });
        const picked = choose(diff, `reference:${path}`, 'replacement', path, [{ optionId: 'clear', label: '从子 Agent 模型范围中移除该别名' }, ...options()]);
        if (!picked) {
            diff.blockedReasons.push(`请处理别名引用：${path}`);
            kept.push(entry);
        }
        else if (picked.optionId !== 'clear') {
            const ref = picked.value;
            entry.provider = ref.providerId;
            entry.model = ref.modelId;
            kept.push(entry);
        }
    });
    if (working.subagents?.allowedModels) {
        working.subagents.allowedModels = kept;
        if (working.subagents.enabled && !kept.length)
            diff.blockedReasons.push('启用子 Agent 模型选择时至少保留一个模型');
    }
    delete working.config.aliases[name];
    try {
        validateConfig(working.config);
    }
    catch (error) {
        diff.blockedReasons.push(String(error));
    }
    diff.referenceChanges = [
        { path: 'aliases', before: state.config.aliases, after: working.config.aliases },
        { path: 'auto', before: state.config.auto, after: working.config.auto },
        { path: 'vision', before: state.config.vision, after: working.config.vision },
        { path: 'agent-default-model', before: state.defaultModel, after: working.defaultModel },
        { path: 'subagent-model-selection', before: state.subagents, after: working.subagents },
        { path: 'overrides', before: state.overrides, after: working.overrides },
    ].filter(change => canonical(change.before) !== canonical(change.after)).map(change => structuredClone(change));
    return { diff, working };
}
