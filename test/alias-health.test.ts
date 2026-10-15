import {afterEach,describe,expect,it} from 'vitest'
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {AliasHealthStore} from '../src/alias-health.js'
import {ModelManagerService} from '../src/service.js'
import {DEFAULT_CONFIG} from '../src/domain.js'
const ref={providerId:'p',modelId:'m'},dirs:string[]=[]
afterEach(async()=>{await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})))})
async function fixture(){const dir=await mkdtemp(join(tmpdir(),'dmm-health-'));dirs.push(dir);let now=1000;const store=await new AliasHealthStore(dir,()=>now).init();return {store,dir,advance:(ms:number)=>{now+=ms}}}
describe('别名冷却与恢复',()=>{
  it.each([['NETWORK',60000],['RATE_LIMIT',300000],['QUOTA',3600000],['AUTH',undefined]] as const)('%s 的默认冷却、重启和公开脱敏',async(code,delay)=>{
    const f=await fixture(),ticket=f.store.claimRecovery('a',ref)!
    await f.store.recordFailure('a',ref,'private-signature',{code,message:'failure'},{},ticket)
    const entry=f.store.snapshot().entries[0]
    expect(entry.retryAt).toBe(delay===undefined?undefined:1000+delay);expect(entry).not.toHaveProperty('signature')
    const reopened=await new AliasHealthStore(f.dir,()=>1000).init()
    expect((await reopened.eligible('a',ref,'private-signature')).allowed).toBe(false)
    expect(reopened.claimRecovery('a',ref)).toBeUndefined()
    expect(await readFile(join(f.dir,'alias-health.json'),'utf8')).not.toContain('failure')
  })
  it('服务端等待优先、健康并发不互斥，过期恢复仅一份租约，取消释放',async()=>{
    const f=await fixture(),one=f.store.claimRecovery('a',ref)!,two=f.store.claimRecovery('a',ref)!
    expect(one).not.toBe(two)
    await f.store.recordFailure('a',ref,'sig',{code:'RATE_LIMIT',message:'wait',providerRetryAfterMs:2000},{rateLimitCooldownSeconds:100},one)
    f.store.release('a',ref,two);f.advance(2000)
    expect((await f.store.eligible('a',ref,'sig')).allowed).toBe(true)
    const recovery=f.store.claimRecovery('a',ref)!
    expect(f.store.claimRecovery('a',ref)).toBeUndefined();expect((await f.store.eligible('a',ref,'sig')).allowed).toBe(false)
    f.store.release('a',ref,recovery)
    const again=f.store.claimRecovery('a',ref)!
    await f.store.recordSuccess('a',ref,'sig',again);expect(f.store.snapshot().entries).toEqual([])
  })
  it.each(['IMAGE_UNSUPPORTED','CONTEXT_WINDOW_EXCEEDED','INVALID_REQUEST','ABORTED'])('%s 不造成长期健康故障',async code=>{
    const {store}=await fixture();await store.recordFailure('a',ref,'sig',{code,message:'skip'},{},store.claimRecovery('a',ref)!);expect(store.snapshot().entries).toEqual([])
  })
  it('手动恢复 CAS、迟到故障与来源签名变化不重新污染状态',async()=>{
    const {store}=await fixture(),old=store.claimRecovery('a',ref)!
    await store.reset('a',store.snapshot().revisionToken)
    await store.recordFailure('a',ref,'old',{code:'AUTH',message:'late'},{},old);expect(store.snapshot().entries).toEqual([])
    const ticket=store.claimRecovery('a',ref)!
    await store.eligible('a',ref,'new')
    await store.recordFailure('a',ref,'old',{code:'AUTH',message:'old key'},{},ticket);expect(store.snapshot().entries).toEqual([])
    await store.recordFailure('a',ref,'new',{code:'AUTH',message:'new key'},{},store.claimRecovery('a',ref)!)
    await expect(store.reset('a','0')).rejects.toThrow('SETTINGS_CONFLICT')
    await store.eligible('a',ref,'replacement');expect(store.snapshot().entries).toEqual([])
  })
  it('损坏主文件可读备份，后续写入不把损坏内容覆盖备份',async()=>{
    const f=await fixture();await f.store.recordFailure('a',ref,'sig',{code:'AUTH',message:'bad'},{},f.store.claimRecovery('a',ref)!)
    await writeFile(join(f.dir,'alias-health.json.bak'),await readFile(join(f.dir,'alias-health.json')))
    await writeFile(join(f.dir,'alias-health.json'),'invalid')
    const reopened=await new AliasHealthStore(f.dir).init();expect(reopened.snapshot().warning).toBeTruthy();expect(reopened.snapshot().entries).toHaveLength(1)
    await reopened.reset('a',reopened.snapshot().revisionToken)
    expect(JSON.parse(await readFile(join(f.dir,'alias-health.json.bak'),'utf8')).entries).toHaveLength(1)
  })
  it('成功候选固定本轮，后续失败只向后走；下一轮重试首选',async()=>{
    const f=await fixture(),service=new ModelManagerService({catalog:async()=>[],applyNative:async()=>{}},f.dir);await service.init()
    const backup={providerId:'q',modelId:'m'},config=structuredClone(DEFAULT_CONFIG);config.aliases.a={candidates:[ref,backup]}
    let lifecycle=service.aliasLifecycle('a',[ref,backup],config,'s',1)
    expect(await lifecycle.admit(ref)).toBeUndefined();await lifecycle.settled(ref,{code:'INVALID_REQUEST',message:'skip'})
    expect(await lifecycle.admit(backup)).toBeUndefined();await lifecycle.settled(backup);lifecycle.release()
    lifecycle=service.aliasLifecycle('a',[ref,backup],config,'s',1);expect(await lifecycle.admit(ref)).toContain('本轮');lifecycle.release()
    service.endTurn('s',1);lifecycle=service.aliasLifecycle('a',[ref,backup],config,'s',2);expect(await lifecycle.admit(ref)).toBeUndefined();lifecycle.release()
  })
  it('临时表单 revision 不改变持久签名，重启服务仍遵守冷却',async()=>{
    const f=await fixture(),config=structuredClone(DEFAULT_CONFIG);config.aliases.a={candidates:[ref]}
    const create=async(revision:number)=>{
      const service=new ModelManagerService({catalog:async()=>[{...ref,name:'m',source:'host',loaded:true,nativeImage:'no',reasoningEfforts:[],nativeRevision:revision}],applyNative:async()=>{}},f.dir)
      await service.init();service.onSettingsChanged(config);return service
    }
    const first=await create(10),life=first.aliasLifecycle('a',[ref],config,'s',1)
    expect(await life.admit(ref)).toBeUndefined();await life.settled(ref,{code:'QUOTA',message:'empty'});life.release()
    const restarted=await create(999999)
    expect(restarted.signature(ref)).toBe(first.signature(ref))
    const next=restarted.aliasLifecycle('a',[ref],config,'other',2)
    expect(await next.admit(ref)).toContain('冷却');next.release()
  })
})
