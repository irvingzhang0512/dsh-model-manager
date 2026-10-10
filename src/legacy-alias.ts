const fields = ['maxAttempts', 'retryTransient', 'parameterDowngrade'] as const
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
export function legacyAliasReliability(raw: unknown): { name: string; values: Record<string, unknown> }[] {
  const aliases = (raw as any)?.aliases
  if (!object(aliases)) return []
  return Object.entries(aliases).flatMap(([name, alias]) => {
    const reliability = (alias as any)?.reliability
    if (!object(reliability)) return []
    const values = Object.fromEntries(fields.filter(key => Object.hasOwn(reliability, key)).map(key => [key, structuredClone(reliability[key])]))
    return Object.keys(values).length ? [{ name, values }] : []
  })
}
export function cleanLegacyAliasReliability(raw: unknown): unknown {
  const aliases = structuredClone((raw as any)?.aliases ?? {})
  for (const { name } of legacyAliasReliability(raw)) {
    for (const key of fields) delete aliases[name].reliability[key]
    if (!Object.keys(aliases[name].reliability).length) delete aliases[name].reliability
  }
  return aliases
}
export function rejectAliasReliability(config: { aliases: Record<string, { reliability?: unknown }> }): void {
  for (const alias of Object.values(config.aliases)) if (alias.reliability !== undefined) throw new Error('别名旧恢复策略已停用，不能新建或修改；请重新加载设置')
}
