import {afterEach,describe,expect,it,vi} from 'vitest'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {EventEmitter} from 'node:events'
import {desktopFixture} from './desktop-fixture.js'
import {HostModelBridge,ModelManagerService} from '../src/service.js'
import {registerOfficialSync} from '../src/official-host.js'
const dirs:string[]=[]
afterEach(async()=>{await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})))})
async function fixture(){
  const f=desktopFixture(),dir=await mkdtemp(join(tmpdir(),'dmm-source-'));dirs.push(dir)
  const entries=()=>f.settings.get('llm-deepseek') as any
  const llm:any={listProviders:()=>[{id:'deepseek-official'}],listConfigurableProviders:()=>[{provider:'deepseek-official',settingsNs:'deepseek-entry',settingsPath:[]}],listModels:async()=>entries().models,resolveModelInfo:async(_p:string,id:string)=>({provider:'deepseek-official',...entries().models.find((m:any)=>m.id===id),reasoning:{efforts:[{id:'high',name:'High'}]}})}
  const service=new ModelManagerService(new HostModelBridge(llm,f.settings),dir,f.settings);await service.init()
  const secret=new Map([['EXISTING_KEY','OLD_SECRET']]),credentials:any={set:vi.fn(async(ref:string,value:string)=>{secret.set(ref,value)}),resolve:async(ref:string)=>secret.has(ref)?{value:secret.get(ref)}:undefined,describe:async(ref:string)=>({configured:secret.has(ref),writable:true})}
  let listing:any[]=[{id:'old',name:'Official name',context_window:2000,input_modalities:['text','image'],max_output_tokens:500,effort:{supported_levels:['low','high'],default_level:'high'}},{id:'new',name:'New model',input_modalities:['text','image'],context_window:2000,max_output_tokens:500}]
  const fetcher=vi.fn(async()=>Response.json({object:'list',data:listing}))
  const ark=vi.fn(async(args:string[])=>args[0]==='auth'?{logged_in:true,active_profile:{name:'default-platform'},profiles_summary:[{name:'chosen',type:'plan'},{name:'default-platform',type:'platform'}]}:{profile:'chosen',type:'plan',items:[{id:'ark-model',invocable:true,data_plane:'plan'},{id:'excluded',invocable:false,data_plane:'plan'},{id:'paygo',invocable:true,data_plane:'platform'}]})
  const routes=new Map<string,Function>(),disposers:Function[]=[]
  registerOfficialSync({llm,settings:f.settings,credentials,webServer:{register:(r:any)=>{if(routes.has(r.path))throw Error('duplicate');routes.set(r.path,r.handler);return()=>{}}},effect:(fn:Function)=>{disposers.push(fn())}} as any,service,{llm,settings:f.settings,credentials,config:()=>service.snapshot().config,fetch:fetcher as any,ark})
  const call=async(path:string,input:any={},method='POST')=>{const res:any=Object.assign(new EventEmitter(),{status:0,body:'',writableEnded:false,destroyed:false,writeHead(v:number){this.status=v},setHeader(){},end(v=''){this.body+=v;this.writableEnded=true}});await routes.get(`/api/model-manager/${path}`)!({method,headers:{host:'127.0.0.1:1234',origin:'dsh-app://app'},socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(input))}},res);return {status:res.status,json:JSON.parse(res.body)}}
  return {...f,call,service,secret,credentials,fetcher,ark,listing:(next:any[])=>{listing=next},dispose:()=>{disposers.reverse().forEach(d=>d?.());service.health.dispose()}}
}
describe('来源目录、凭据与共享事务',()=>{
  it('来源标识只接受宿主已知关联，拒绝伪造或变更 Provider',async()=>{
    const f=await fixture()
    const result=await f.call('sources/preview',{kind:'deepseek',sourceId:'forged'})
    expect(result.status).toBe(400);expect(f.fetcher).not.toHaveBeenCalled();f.dispose()
  })
  it('Key 独立保存、预览不写目录，取消使 token 失效且保留新引用',async()=>{
    const f=await fixture(),before=structuredClone(f.raw)
    const saved=await f.call('sources/credential',{sourceKind:'deepseek',newKey:'NEW_SECRET'})
    expect(saved.status).toBe(200);expect(saved.json.credentialRef).toMatch(/^DMM_DEEPSEEK_[A-F0-9]{32}$/)
    const preview=await f.call('sources/preview',{kind:'deepseek',credentialRef:saved.json.credentialRef})
    expect(preview.status,JSON.stringify(preview.json)).toBe(200);expect(f.raw).toEqual(before);expect(f.secret.get(saved.json.credentialRef)).toBe('NEW_SECRET')
    expect(JSON.stringify(preview.json)).not.toContain('NEW_SECRET');expect(JSON.stringify(preview.json.models)).toContain('推理资料')
    const canceled=await f.call('catalog-resolve',{token:preview.json.catalog.token,selected:[],resolutions:[],cancel:true});expect(canceled.json.cancelled).toBe(true)
    expect((await f.call('catalog-apply',{token:preview.json.catalog.token,selected:preview.json.catalog.selected})).status).toBe(400)
    expect(f.raw).toEqual(before);expect(f.secret.has(saved.json.credentialRef)).toBe(true);f.dispose()
  })
  it('默认不覆盖自定义值，不选最大输出；应用及恢复保留未知字段、原凭据和独立备份指针',async()=>{
    const f=await fixture(),before=structuredClone(f.raw),p=await f.call('sources/preview',{kind:'deepseek'})
    expect(p.status,JSON.stringify(p.json)).toBe(200)
    const catalog=p.json.catalog
    expect(catalog.origin).toBe('source');expect(catalog.selected).toHaveLength(1)
    const cap=catalog.operations.find((o:any)=>o.model.modelId==='new' && o.after?.maxTokens===500)
    expect(cap).toBeTruthy();expect(catalog.selected).not.toContain(cap.id)
    const apply=await f.call('catalog-apply',{token:catalog.token,selected:catalog.selected})
    expect(apply.status,JSON.stringify(apply.json)).toBe(200)
    const models=f.raw['deepseek-entry'].models
    expect(models[0]).toEqual(before['deepseek-entry'].models[0]);expect(models.find((m:any)=>m.id==='new')).not.toHaveProperty('maxTokens')
    expect(f.raw['deepseek-entry'].unknown).toEqual({preserve:true});expect(f.raw['deepseek-entry'].apiKeyEnv).toBe('EXISTING_KEY')
    expect(apply.json.snapshot.sourceBackupId).toBe(apply.json.backupId)
    const restored=await f.call('catalog-restore',{backupId:apply.json.backupId});expect(restored.status,JSON.stringify(restored.json)).toBe(200);expect(f.raw).toEqual(before);f.dispose()
  })
  it('目录请求期间并发编辑拒绝应用，后续来源预览不删除下架模型',async()=>{
    const f=await fixture(),p=await f.call('sources/preview',{kind:'deepseek'})
    f.base['deepseek-entry'].concurrent='external'
    expect((await f.call('catalog-apply',{token:p.json.catalog.token,selected:p.json.catalog.selected})).status).toBe(409)
    f.listing([{id:'new'}]);const next=await f.call('sources/preview',{kind:'deepseek'})
    expect(next.status).toBe(200);expect(next.json.catalog.operations.some((o:any)=>o.kind==='remove')).toBe(false);expect(f.raw['deepseek-entry'].models[0].id).toBe('old');f.dispose()
  })
  it('指定套餐 Profile 查询、过滤不兼容资源，源连接与目录同一写集并可恢复',async()=>{
    const f=await fixture(),saved=await f.call('sources/credential',{sourceKind:'ark-agent-plan',newKey:'PLAN_SECRET'})
    const p=await f.call('sources/preview',{kind:'ark-agent-plan',providerId:'ark-plan',arkProfile:'chosen',credentialRef:saved.json.credentialRef})
    expect(p.status,JSON.stringify(p.json)).toBe(200);expect(p.json.models.map((m:any)=>m.model.modelId)).toEqual(['ark-model'])
    expect(f.ark.mock.calls[1][0]).toEqual(['resources','list','--modality','text','--profile','chosen'])
    const applied=await f.call('catalog-apply',{token:p.json.catalog.token,selected:p.json.catalog.selected})
    expect(applied.status,JSON.stringify(applied.json)).toBe(200)
    expect(f.raw['pi-entry'].providers['ark-plan']).toMatchObject({api:'openai-completions',baseURL:'https://ark.cn-beijing.volces.com/api/plan/v3',apiKeyEnv:saved.json.credentialRef,models:[{id:'ark-model'}]})
    expect(Object.values(f.raw['manager-entry'].sources)[0]).toMatchObject({arkProfile:'chosen'})
    expect((await f.call('catalog-restore',{backupId:applied.json.backupId})).status).toBe(200)
    expect(f.raw['pi-entry'].providers).toEqual({});expect(f.secret.get(saved.json.credentialRef)).toBe('PLAN_SECRET');f.dispose()
  })
  it('不选择平台 Profile，不回显账户秘密；写失败回滚其他所有者',async()=>{
    const f=await fixture(),before=structuredClone(f.raw)
    expect((await f.call('sources/preview',{kind:'ark-agent-plan',arkProfile:'default-platform'})).status).toBe(400)
    expect(f.ark.mock.calls).toHaveLength(1)
    const p=await f.call('sources/preview',{kind:'deepseek'})
    f.fail('deepseek-entry')
    const a=await f.call('catalog-apply',{token:p.json.catalog.token,selected:p.json.catalog.selected})
    expect(a.status).toBe(400);expect(a.json.error).toContain('回滚');expect(f.raw).toEqual(before)
    const source=await f.call('sources',{},'GET');expect(source.status).toBe(200);expect(JSON.stringify(source.json)).not.toContain('OLD_SECRET');f.dispose()
  })
})
