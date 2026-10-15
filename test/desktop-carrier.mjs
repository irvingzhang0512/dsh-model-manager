// Run only with the installed Desktop's Electron Node carrier against a marked,
// stopped desktop-dev fixture. Every inference route is synthetic and fenced.
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {createRequire} from 'node:module'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
const state=JSON.parse(fs.readFileSync(process.argv[2],'utf8'))
assert.equal(state.kind,'dsh-desktop-development')
assert.ok(state.root.includes(`${path.sep}.local${path.sep}`))
assert.equal(state.pid,null,'Stop the managed fixture before this test')
const pkg=name=>pathToFileURL(path.join(state.asar,'dsh/node_modules/@deepseek-ai',name,'lib/index.js')).href
const {loadProfileDirectory,loadLayeredEnv}=await import(pkg('dsh-app-boot'))
const {runProfile}=await import(pathToFileURL(path.join(state.asar,'dsh/node_modules/@deepseek-ai/dsh/lib/profile-boot.js')).href)
const {LlmAdapter,createUserMessage}=await import(pkg('dsh-llm'))
const {defineTool}=await import(pkg('dsh-tools'))
const {credentialRef}=await import(pkg('dsh-credentials'))
const anchor=path.join(state.asar,'dsh/node_modules/@deepseek-ai/dsh/package.json')
const app=await runProfile({environment:loadLayeredEnv('dsh'),profile:'desktop',resolvedProfile:{profile:loadProfileDirectory('dsh',state.profile,anchor),installAnchor:anchor},patchFiles:[],args:['--no-open']})
const {ctx}=app,provider='dmm-fixture',calls=[],errors=[],handles=[],disposers=[]
const ref=modelId=>({providerId:provider,modelId})
let tools=0,backupRequests=0
const text=function*(value){yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:value};yield {type:'block-end',index:0,block:{type:'text',text:value}};yield {type:'finish',reason:{kind:'stop'},replayState:{response:{fixture:true},blocks:[{fixture:true}]}}}
class FixtureAdapter extends LlmAdapter {
  providerInfo(){return {id:provider,name:'isolated fixture'}}
  providerRetryPolicy(){return {mode:'normal',maxRetries:0,retryableCodes:[],initialDelayMs:1,maxDelayMs:1,jitterRatio:0}}
  imageRequestPricing(){return {priceImages:images=>images.map(()=>({visualTokens:1024,text:''}))}}
  async listModels(){return ['primary','backup','vision','evaluator','native','slow'].map(id=>({provider,id,name:id,inputModalities:['vision','native'].includes(id)?['text','image']:['text']}))}
  async resolveModel(_p,id){return {...(await this.listModels()).find(m=>m.id===id),context:{contextWindow:65536},reasoning:{efforts:[{id:'low',name:'Low'},{id:'high',name:'High'}]}}}
  async *stream(options){
    calls.push({model:options.model,purpose:options.purpose,images:options.messages.flatMap(m=>m.content.filter(b=>b.type==='image')).length,observations:options.messages.filter(m=>m.source?.kind==='model-manager-vision').length,effort:options.reasoningEffort})
    if(options.model==='evaluator'){yield* text(JSON.stringify({taskType:'coding',grade:'simple',reason:'fixture classification'}));return}
    if(options.model==='vision'){yield* text('图片中可见一个纯色方块。');return}
    if(options.model==='primary'){yield {type:'finish',reason:{kind:'error',failure:{code:'RATE_LIMIT',status:429,message:'fixture limited',providerRetryAfterMs:60000}}};return}
    if(options.model==='slow'){yield {type:'text-delta',index:0,text:'must never commit'};await new Promise(()=>{});return}
    if(options.model==='backup'){
      if(!options.purpose)backupRequests++
      const requested=options.messages.some(m=>m.role==='user' && m.content.some(b=>b.type==='text' && b.text.includes('[fixture-main]')))
      if(requested && !options.messages.some(m=>m.role==='tool')){
        yield {type:'block-start',index:0,blockType:'tool-call'}
        yield {type:'tool-call-delta',index:0,id:'fixture-image-call',name:'dmm_fixture_image',argumentsDelta:'{}'}
        yield {type:'block-end',index:0,block:{type:'tool-call',id:'fixture-image-call',name:'dmm_fixture_image',arguments:'{}'}}
        yield {type:'finish',reason:{kind:'tool-calls'}};return
      }
    }
    yield* text('fixture completed')
  }
}
let before,report={version:state.version,synthetic:true,checks:[]},exitCode=0
const startupDeadline=Date.now()+60_000
const call=async(method,suffix,body)=>{
  const url=new URL(ctx.connection.authenticatedUrl(`http://127.0.0.1:${ctx.webServer.port}`));url.pathname=`/api/model-manager${suffix}`
  const response=await fetch(url,{method,headers:{Origin:'dsh-app://app','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})
  const value=await response.json()
  if(method==='GET' && suffix==='' && response.status===503 && Date.now()<startupDeadline){await new Promise(r=>setTimeout(r,100));return call(method,suffix,body)}
  assert.equal(response.status,200,`${suffix}: ${value.error ?? response.status}`);return value
}
const idle=async agent=>{let timer;try{await Promise.race([agent.whenIdle(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('agent idle timeout')),15000)})])}finally{clearTimeout(timer)}}
const create=async(model='auto',meta={})=>{const handle=await ctx.agents.create({sessionId:`session-${randomUUID()}`,meta:{cwd:path.join(state.root,'workspace'),...meta},agentOptions:{provider:'dsh-model-manager',model}});handles.push(handle);return handle.agent}
const send=async(agent,prompt,images=[])=>{agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:prompt},...images.map(attachment=>({type:'image',attachment}))]}));await idle(agent)}
try {
  const marker=credentialRef(`DMM_FIXTURE_${randomUUID().replaceAll('-','').toUpperCase()}`)
  try {
    await ctx.credentials.set(marker,'synthetic-marker')
    assert.equal((await ctx.credentials.describe(marker)).configured,true)
    assert.equal((await ctx.credentials.resolve(marker)).value,'synthetic-marker')
  } finally { await ctx.credentials.unset(marker) }
  assert.equal((await ctx.credentials.describe(marker)).configured,false)
  report.checks.push('native Credentials saves/resolves/removes independent marker')
  disposers.push(ctx.on('llm/stream',(options,next)=>['dsh-model-manager',provider].includes(options.provider)?next():(async function*(){throw Error('external inference fenced')})(),{global:true,prepend:true}))
  disposers.push(ctx.on('agent/error',({error})=>errors.push(String(error)),{global:true}))
  disposers.push(ctx.llm.registerAdapter([provider],new FixtureAdapter()))
  const sharp=createRequire(path.join(state.root,'source/package.json'))('sharp')
  const image=await ctx.attachments.saveImage({data:await sharp({create:{width:2,height:2,channels:3,background:'#f00'}}).png().toBuffer(),mediaType:'image/png'})
  const toolImage=await ctx.attachments.saveImage({data:await sharp({create:{width:3,height:3,channels:3,background:'#00f'}}).png().toBuffer(),mediaType:'image/png'})
  disposers.push(ctx.tools.register(defineTool({name:'dmm_fixture_image',description:'Synthetic fixture image tool',parameters:{},output:{schema:{type:'object',properties:{},additionalProperties:false},render:()=>[{type:'image',attachment:toolImage}]},execute:async()=>{tools++;return {}}})))
  before=await call('GET','')
  const config=structuredClone(before.config)
  config.aliases.fixture={candidates:[ref('primary'),ref('backup')]};config.aliases.slow={candidates:[ref('slow')]}
  config.auto={...config.auto,enabled:true,evaluator:ref('evaluator'),evaluatorReasoningEffort:'low',simple:{target:'@fixture'},normal:{target:'@fixture'},complex:{target:'@fixture'},rules:[{id:'coding',name:'Coding fixture',enabled:true,taskTypes:['coding'],selection:{target:'@fixture'}}]}
  config.vision={enabled:true,automatic:true,policy:'native-first',target:ref('vision')}
  await call('PUT','',{revision:before.revision,config})
  const initialHealth=await call('GET','/alias-health');await call('POST','/alias-health',{alias:'fixture',expectedRevisionToken:initialHealth.revisionToken})
  const agent=await create()
  await send(agent,'[fixture-main] 编写函数，并解释图片。',[image])
  assert.deepEqual(errors,[])
  assert.equal(calls.filter(c=>c.model==='evaluator').length,1)
  assert.equal(calls.filter(c=>c.model==='vision').length,2,'new user and tool images each receive observations')
  assert.ok(calls.filter(c=>c.model==='primary' && !c.purpose).length<=1)
  assert.equal(backupRequests,2);assert.equal(tools,1)
  assert.ok(calls.filter(c=>c.model==='backup' && !c.purpose).every(c=>c.images===0 && c.observations>0))
  const notices=agent.session.deriveMessages().filter(m=>m.source.kind==='model-manager-vision')
  assert.equal(notices.length,2);assert.ok(notices.every(m=>m.source.provider===provider && m.source.model==='vision' && m.source.form==='notice'))
  report.checks.push('automatic user/tool images admitted with attributed notices','AUTO once per turn and pinned backup across tool steps','failed primary output absent; completed tool exactly once')
  const firstPrimaryCount=calls.filter(c=>c.model==='primary').length
  await send(agent,'继续追问前面的图片。')
  const primaryCount=calls.filter(c=>c.model==='primary').length
  assert.equal(calls.filter(c=>c.model==='evaluator').length,2);assert.equal(primaryCount,firstPrimaryCount);assert.equal(tools,1)
  const health=await call('GET','/alias-health'),count=calls.length
  await call('POST','/alias-health',{alias:'fixture',expectedRevisionToken:health.revisionToken})
  assert.equal(calls.length,count,'manual recovery sends no probe')
  report.checks.push('historical follow-up and cooldown reused','manual recovery has no inference')
  const fork=await create('auto',{parentSession:agent.session.id})
  await send(fork,'[fixture-fork] 继续父任务。')
  assert.equal(calls.filter(c=>c.model==='evaluator').length,2)
  assert.equal(calls.at(-1).model,'backup')
  report.checks.push('fork uses actual parent backup without AUTO evaluation')
  const child=await ctx.agents.create({sessionId:`session-${randomUUID()}`,parentAgent:agent,meta:{origin:'subagent',cwd:path.join(state.root,'workspace')},agentOptions:{provider,model:'native'}});handles.push(child)
  await send(child.agent,'原生子任务。')
  assert.equal(calls.filter(c=>c.model==='evaluator').length,2)
  const native=await ctx.agents.create({sessionId:`session-${randomUUID()}`,meta:{cwd:path.join(state.root,'workspace')},agentOptions:{provider,model:'native'}});handles.push(native)
  const visualBefore=calls.filter(c=>c.model==='vision').length
  await send(native.agent,'直接看图。',[image]);assert.equal(calls.filter(c=>c.model==='vision').length,visualBefore)
  report.checks.push('native Subagent isolated from AUTO','native vision avoids auxiliary inference')
  const slow=await create('alias:slow');slow.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'[fixture-cancel]'}]}))
  for(let i=0;i<100 && !calls.some(c=>c.model==='slow');i++)await new Promise(r=>setTimeout(r,10))
  slow.cancel({kind:'user'});await idle(slow)
  assert.ok(!slow.session.deriveMessages().some(m=>m.role==='assistant' && m.content.some(b=>b.type==='text' && b.text.includes('must never commit'))))
  report.checks.push('cancellation discards buffered partial output')
  report.calls=calls.map(c=>({model:c.model,images:c.images,observations:c.observations}));report.tools=tools;report.passed=true
} catch(error) {exitCode=1;report.passed=false;report.error=String(error);report.stack=error.stack;report.agentErrors=errors;report.calls=calls;report.backupRequests=backupRequests;report.tools=tools;console.error(String(error))}
finally {
  for(const handle of handles.reverse())await handle.dispose().catch(()=>{})
  if(before){try{const current=await call('GET','');await call('PUT','',{revision:current.revision,config:before.config})}catch(error){exitCode=1;report.restoreError=String(error)}}
  for(const dispose of disposers.reverse())await dispose?.()
  fs.mkdirSync(path.join(state.root,'reports'),{recursive:true})
  const output=path.join(state.root,'reports',`carrier-${Date.now()}.json`);fs.writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx'})
  console.log(JSON.stringify({passed:report.passed,checks:report.checks,output}))
  await app.shutdown.shutdown(exitCode)
}
