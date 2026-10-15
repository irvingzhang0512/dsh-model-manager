import {describe,expect,it} from 'vitest'
import {applyOwner,describeOwners,unpack} from '../src/desktop-settings.js'
import {hostRouteUrl} from '../src/client/transport.js'
import {trusted} from '../src/http-trust.js'
import {desktopFixture} from './desktop-fixture.js'
describe('Desktop 实际所有者和配置层',()=>{
  it('真实条目 ID 映射、实时字段用表单、未知字段和继承层保持',async()=>{
    const f=desktopFixture(),section=f.settings.describe().find(d=>d.ns==='llm-deepseek')!
    expect(f.settings.namespaceFor('deepseek-entry')).toBe('llm-deepseek')
    await f.settings.mutate('llm-deepseek',[{op:'set',path:['models'],value:[{id:'new',inputModalities:['text','image']}]}],section.revision)
    expect(f.writes[0].via).toBe('forms');expect(f.writes[0].id).toBe('deepseek-entry');expect(f.raw['deepseek-entry'].apiKeyEnv).toBe('EXISTING_KEY');expect(f.raw['deepseek-entry'].unknown).toEqual({preserve:true})
    expect(f.base['deepseek-entry']).toEqual({})
    expect(unpack(f.rows.find(r=>r.entry.options.id==='deepseek-entry')!.entry.fiber.config).models[0].id).toBe('new')
  })
  it('普通字段走配置编辑器，在锁内检查原始层和继承层',async()=>{
    const f=desktopFixture(),revision=f.settings.describe().find(d=>d.ns==='agent-default-model')!.revision
    f.beforeEdit(()=>{f.base['default-entry'].concurrent=true})
    await expect(f.settings.mutate('agent-default-model',[{op:'set',path:['model'],value:'new'}],revision)).rejects.toThrow('SETTINGS_CONFLICT')
    expect(f.raw['default-entry'].model).toBe('old')
    const next=f.settings.describe().find(d=>d.ns==='agent-default-model')!.revision
    await f.settings.mutate('agent-default-model',[{op:'set',path:['model'],value:'new'}],next)
    expect(f.writes.at(-1)?.via).toBe('editor');expect(f.raw['default-entry'].unknown).toBe(7)
  })
  it('动态别名、同包多条目与危险路径不能越权写入',async()=>{
    const f=desktopFixture(),revision=f.settings.describe().find(d=>d.ns==='llm-deepseek')!.revision
    await expect(f.settings.mutate('llm-deepseek',[{op:'set',path:['secret'],value:'x'}],revision)).rejects.toThrow('未公开')
    await expect(f.settings.mutate('llm-deepseek',[{op:'set',path:['models','__proto__','x'],value:'x'}],revision)).rejects.toThrow()
    f.rows.push({...f.rows[1],entry:{...f.rows[1].entry,options:{...f.rows[1].entry.options,id:'second'}}})
    expect(()=>f.settings.row('llm-deepseek')).toThrow('不唯一')
  })
  it('所有者公开入口复用同一 CAS 记录，失败不覆盖用户层',async()=>{
    const f=desktopFixture(),ctx={configEditor:f.editor,settings:f.forms},owner=describeOwners(ctx).find(d=>d.owner==='llm-deepseek')!
    await applyOwner(ctx,owner.entryId,owner.revisionToken,[{op:'set',path:['baseURL'],value:'https://example.test'}])
    await expect(applyOwner(ctx,owner.entryId,owner.revisionToken,[{op:'set',path:['baseURL'],value:'https://wrong.test'}])).rejects.toThrow('SETTINGS_CONFLICT')
    expect(f.raw['deepseek-entry'].baseURL).toBe('https://example.test')
  })
  it('Desktop 回环传输和精确信任来源，不放行 null 或其他自定义来源',()=>{
    const prior=(globalThis as any).__DSH_TRANSPORT__
    const location=(globalThis as any).location
    try{(globalThis as any).__DSH_TRANSPORT__={streamBaseUrl:'http://127.0.0.1:9123'};expect(hostRouteUrl('/api/model-manager')).toBe('http://127.0.0.1:9123/api/model-manager');(globalThis as any).location={protocol:'dsh-app:',href:'dsh-app://app/'};expect(hostRouteUrl('/api/model-manager')).toBe('dsh-app://app/api/model-manager')}finally{(globalThis as any).__DSH_TRANSPORT__=prior;(globalThis as any).location=location}
    const req=(origin:string,remoteAddress='127.0.0.1',site?:string)=>({headers:{origin,host:'127.0.0.1:9123','sec-fetch-site':site},socket:{remoteAddress}} as any)
    expect(trusted(req('dsh-app://app'))).toBe(true);expect(trusted(req('null'))).toBe(false);expect(trusted(req('dsh-app://other'))).toBe(false);expect(trusted(req('dsh-app://app','192.168.1.1'))).toBe(false);expect(trusted(req('dsh-app://app','127.0.0.1','cross-site'))).toBe(false)
  })
})
