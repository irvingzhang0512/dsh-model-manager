import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

describe('客户端 bundle', () => {
  it('loader id 与包名一致，设置区和输入区插槽注册', async () => {
    let loaded: any
    const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
    const react = { createElement: () => ({}), useState: (value: unknown) => [value, () => {}], useEffect: () => {} }
    const document = { querySelector: () => ({}), createElement: () => ({}), head: { appendChild: () => {} } }
    runInNewContext(source, { window: { __ModuleLoader__: { load: (entry: any) => { loaded = entry } } }, document })
    expect(loaded.id).toBe('dsh-model-manager')
    const module = loaded.factory((name: string) => name === 'react' ? react : { jsx: () => ({}), jsxs: () => ({}) })
    const slots: string[] = []
    module.apply({ slots: { inject: (name: string, callback: () => void) => { slots.push(name); callback() }, register: () => () => {} } })
    expect(slots).toContain('settings.section')
    expect(slots).toContain('conversation.input.left')
  })
})
