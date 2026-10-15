import {afterEach,describe,expect,it,vi} from 'vitest'
import {candidateForTask,evaluateTask,requestInputTokens} from '../src/auto-router.js'
import {aliasMetadata} from '../src/alias-runtime.js'
import {DEFAULT_CONFIG,modelKey,type ModelRecord} from '../src/domain.js'
import {unwrapReplay,wrapReplay} from '../src/replay.js'
const model=(id:string,window=10000):ModelRecord=>({providerId:'p',modelId:id,name:id,nativeImage:'yes',loaded:true,source:'host',reasoningEfforts:[{id:'high',name:'High'}],contextWindow:window})
const options:any={messages:[{role:'user',source:{kind:'user'},content:[{type:'text',text:'请写一个函数'}]}],maxTokens:100}
const config=()=>{const c=structuredClone(DEFAULT_CONFIG);c.auto.evaluator={providerId:'p',modelId:'eval'};for(const grade of ['simple','normal','complex'] as const)c.auto[grade].target={providerId:'p',modelId:grade};return c}
afterEach(()=>vi.useRealTimers())
describe('Desktop AUTO 与逻辑能力',()=>{
  it('冷却不可用的规则进入后续档位，同一模型在另一别名仍可用',()=>{
    const c=config(),ref={providerId:'p',modelId:'normal'},models=[model('normal'),model('complex')]
    c.aliases.cooling={candidates:[ref]};c.aliases.healthy={candidates:[ref]}
    c.auto.rules=[{id:'cold',name:'冷却规则',enabled:true,taskTypes:['coding'],selection:{target:'@cooling'}},{id:'ready',name:'可用规则',enabled:true,taskTypes:['coding'],selection:{target:'@healthy'}}]
    const available=(_ref:any,selection:any)=>selection.target!=='@cooling'
    expect(candidateForTask(c,models,'coding','normal',options,undefined,true,undefined,available)?.ruleId).toBe('ready')
    c.auto.normal.target='@cooling';expect(candidateForTask(c,models,'writing','normal',options,undefined,true,undefined,available)?.grade).toBe('complex')
    expect(candidateForTask(c,models.map(m=>({...m,loaded:false})),'coding','normal',options)).toBeUndefined()
  })
  it('规则按顺序采用第一个兼容目标，无匹配使用复杂度档和升级，池外模型不进入',()=>{
    const c=config(),models=[model('simple'),model('normal'),model('complex'),model('outside')]
    c.auto.rules=[{id:'unavailable',name:'缺失',enabled:true,taskTypes:['coding'],selection:{target:{providerId:'missing',modelId:'missing'}}},{id:'first',name:'优先',enabled:true,taskTypes:['coding'],grades:['normal'],selection:{target:{providerId:'p',modelId:'complex'}}},{id:'second',name:'后续',enabled:true,taskTypes:['coding'],selection:{target:{providerId:'p',modelId:'simple'}}}]
    expect(candidateForTask(c,models,'coding','normal',options)?.ruleId).toBe('first')
    expect(candidateForTask(c,models,'writing','normal',options)?.selection.target).toEqual({providerId:'p',modelId:'normal'})
    expect(candidateForTask(c,models.filter(m=>m.modelId==='outside'),'general','normal',options)).toBeUndefined()
  })
  it('计量包含系统、历史、工具和路由图片视觉 token；完整压力可阻止候选',()=>{
    const c=config(),models=[model('simple',1500),model('normal',10000)]
    const request={...options,system:'x'.repeat(1000),messages:[...options.messages,{role:'tool',content:[{type:'image',attachment:{attachmentId:'img'}}]}],tools:[{name:'tool',description:'x'.repeat(5000)}]}
    expect(requestInputTokens(request,{priceImages:()=>[{visualTokens:4000,text:'image handle'}]})).toBeGreaterThan(5000)
    expect(candidateForTask(c,models,'general','simple',request)?.grade).toBe('normal')
    expect(candidateForTask(c,models,'general','simple',options,undefined,true,()=>20000)).toBeUndefined()
  })
  it('10 秒硬超时可结束忽略 signal 的迭代器，主动停止不降级',async()=>{
    vi.useFakeTimers();const stream=vi.fn(()=>({[Symbol.asyncIterator]:()=>({next:()=>new Promise(()=>{}),return:async()=>({done:true})})}))
    const pending=evaluateTask({stream} as any,config(),options)
    await vi.advanceTimersByTimeAsync(10000);expect(await pending).toMatchObject({grade:'normal',taskType:'general',fallback:true,durationMs:10000})
    const controller=new AbortController(),cancelled=evaluateTask({stream} as any,config(),{...options,signal:controller.signal})
    const rejected=expect(cancelled).rejects.toThrow('stopped');controller.abort(Error('stopped'));await rejected
  })
  it('评估仅用真实用户文字与近期回答，不把图片观察、工具正文或系统提示发给评估器',async()=>{
    const c=config();c.auto.evaluatorReasoningEffort='high'
    const stream=vi.fn(async function*(request:any){expect(request.messages[0].content[0].text).not.toMatch(/SECRET_IMAGE|SECRET_TOOL|SECRET_SYSTEM/);yield {type:'text-delta',text:JSON.stringify({taskType:'coding',grade:'simple',reason:'小型代码任务'})};yield {type:'finish',reason:{kind:'stop'}}})
    const result=await evaluateTask({stream} as any,c,{...options,system:'SECRET_SYSTEM',messages:[...options.messages,{role:'tool',content:[{type:'text',text:'SECRET_TOOL'}]},{role:'user',source:{kind:'model-manager-vision'},content:[{type:'text',text:'SECRET_IMAGE'}]}]})
    expect(result.taskType).toBe('coding');expect(stream.mock.calls[0][0].reasoningEffort).toBe('high');expect(stream).toHaveBeenCalledTimes(1)
  })
  it('逻辑入口推理档位取所有候选交集，不能沿用首个默认',async()=>{
    const llm:any={resolveModelInfo:async(_p:string,m:string)=>({provider:'p',id:m,name:m,context:{contextWindow:m==='a'?1000:2000},reasoning:{efforts:(m==='a'?['low','high']:['high','max']).map(id=>({id,name:id})),defaultEffort:'high'}})}
    const result=await aliasMetadata(llm,[{providerId:'p',modelId:'a'},{providerId:'p',modelId:'b'}])
    expect(result.reasoning).toEqual({efforts:[{id:'high',name:'high'}]});expect(result.context?.contextWindow).toBe(2000);expect(result.defaultMaxTokens).toBeUndefined()
  })
  it('显式档位不兼容时跳过候选，不把别名首候选强度冒充整体能力',()=>{
    const c=config(),a=model('a'),b={...model('b'),reasoningEfforts:[{id:'low',name:'Low'}]};c.aliases.ordered={candidates:[a,b],efforts:{[modelKey(a)]:'high',[modelKey(b)]:'low'}};c.auto.simple={target:'@ordered'}
    expect(candidateForTask(c,[a,b],'general','simple',{...options,reasoningEffort:'low'})?.candidates).toEqual([b])
  })
  it('重放包装保留实际 Provider、模型及逐块状态，不改消息内容',()=>{
    const ref={providerId:'p',modelId:'real'},chunk:any=wrapReplay({type:'finish',reason:{kind:'stop'},replayState:{response:{id:'native-response'},blocks:[{opaque:'native-block'}]}} as any,ref)
    const message:any={id:'assistant',role:'assistant',source:{kind:'model',provider:'dsh-model-manager',model:'auto',replayState:chunk.replayState},content:[{type:'text',text:'answer'}]}
    const result=unwrapReplay([message])[0]
    expect(result).toMatchObject({source:{provider:'p',model:'real',replayState:{response:{id:'native-response'},blocks:[{opaque:'native-block'}]}}});expect(result.content).toEqual(message.content);expect(message.source.provider).toBe('dsh-model-manager')
  })
})
