import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import type { CatalogState } from './catalog-types.js'
import type { HostParameterCatalog } from './model-parameters.js'

/** 使用与宿主适配器相同的已安装公开目录 API；失败保守标 unknown。 */
export async function readParameterCatalog(state: CatalogState): Promise<HostParameterCatalog> {
  const catalog: HostParameterCatalog = {}
  try {
    const host = await import('@deepseek-ai/dsh-llm-deepseek')
    const defaults = host.Config({})
    catalog['deepseek-official'] = Object.fromEntries((defaults.models ?? []).map((model: any) => [model.id, { id: model.id, name: model.name, description: model.description, contextWindow: model.contextWindow, maxTokens: model.maxTokens, inputModalities: model.inputModalities, imagePixelBudget: model.imagePixelBudget, imageMaxBytes: model.imageMaxBytes, systemPromptUpdate: model.systemPromptUpdate }]))
  } catch { /* 宿主未提供公开目录模块时不能伪造目录来源。 */ }
  try {
    const require = createRequire(import.meta.url)
    const hostRequire = createRequire(require.resolve('@deepseek-ai/dsh-llm-pi-ai'))
    // 此包只有 import 导出；CJS require.resolve 不支持该条件。按同一解析目录
    // 读取其公开 export map，不能猜 dist 路径或读取适配器私有实现。
    let packagePath: string | undefined, manifest: any
    for (const path of hostRequire.resolve.paths('@earendil-works/pi-ai') ?? []) {
      const file = join(path, '@earendil-works/pi-ai/package.json')
      try { manifest = JSON.parse(await readFile(file, 'utf8')); packagePath = file; break } catch {}
    }
    if (!packagePath) return catalog
    const exported = (name: string) => {
      const pattern = name === '.' ? '.' : './providers/*', declaration = manifest.exports?.[pattern]
      const entry = typeof declaration === 'string' ? declaration : declaration?.import
      if (typeof entry !== 'string' || !entry.startsWith('./') || entry.includes('..')) throw new Error('公开目录导出不可用')
      return pathToFileURL(join(dirname(packagePath!), entry.replace('*', 'all'))).href
    }
    const all = await import(exported('./providers/all'))
    const pi = await import(exported('.'))
    for (const profile of state.profiles.filter(p => p.ns === 'llm-pi-ai')) {
      if (!all.getBuiltinProviders().includes(profile.providerId)) { catalog[profile.providerId] = {}; continue }
      catalog[profile.providerId] = Object.fromEntries(all.getBuiltinModels(profile.providerId).map((model: any) => {
        const reasoningEfforts = model.reasoning ? Object.fromEntries(pi.getSupportedThinkingLevels(model).map((level: string) => [level, model.thinkingLevelMap?.[level] ?? (level === 'off' ? null : level)])) : false
        return [model.id, { id: model.id, name: model.name, api: model.api, contextWindow: model.contextWindow, maxTokens: model.maxTokens, input: model.input, reasoningEfforts, compat: model.compat }]
      }))
    }
  } catch { /* 不能证明来源时不按展示值猜 catalog。 */ }
  return catalog
}
