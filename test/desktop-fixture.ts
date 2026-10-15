import {DesktopSettings,unpack} from '../src/desktop-settings.js'
import {DEFAULT_CONFIG} from '../src/domain.js'
const packages:Record<string,string>={'manager-entry':'dsh-model-manager','deepseek-entry':'@deepseek-ai/dsh-llm-deepseek-api-key','pi-entry':'@deepseek-ai/dsh-llm-pi-ai','default-entry':'@deepseek-ai/dsh-agent-default-model'}
const merge=(base:any,user:any):any=>base && user && typeof base==='object' && typeof user==='object' && !Array.isArray(base) && !Array.isArray(user) ? Object.fromEntries([...new Set([...Object.keys(base),...Object.keys(user)])].map(k=>[k,Object.hasOwn(user,k)?merge(base[k],user[k]):base[k]])) : user===undefined?base:user
export function desktopFixture(){
  const raw:Record<string,any>={'manager-entry':structuredClone(DEFAULT_CONFIG),'deepseek-entry':{apiKeyEnv:'EXISTING_KEY',models:[{id:'old',name:'自定义名称',inputModalities:['text'],contextWindow:1000,custom:{preserve:true}}],unknown:{preserve:true}},'pi-entry':{providers:{}},'default-entry':{provider:'deepseek-official',model:'old',unknown:7}}
  const base:Record<string,any>=Object.fromEntries(Object.keys(raw).map(k=>[k,{}])),revisions:Record<string,number>=Object.fromEntries(Object.keys(raw).map(k=>[k,1]))
  const rows=Object.keys(raw).map(id=>({entry:{options:{id,name:packages[id]},fiber:{uid:`fixture:${id}`,get config(){const v=merge(base[id],raw[id]);return id==='manager-entry'?{get:()=>v}:Object.fromEntries(Object.entries(v).map(([k,value])=>[k,{get:()=>value}]))}}},get override(){return raw[id]},get inherited(){return base[id]}}))
  let beforeEdit:undefined|(()=>void),failOwner:string|undefined
  const writes:{id:string;ops:any[];via:string}[]=[]
  const apply=(id:string,ops:any[])=>{if(id===failOwner){failOwner=undefined;throw Error('injected write failure')}const next=structuredClone(raw[id]);for(const op of ops){let node=next;for(const k of op.path.slice(0,-1))node=node[k]??={};if(op.op==='unset')delete node[op.path.at(-1)];else node[op.path.at(-1)]=structuredClone(op.value)}raw[id]=next;revisions[id]++}
  const editor:any={documentPath:'fixture/profiles/desktop/cordis.yml',configuration:()=>rows,edit:async(entry:any,fn:Function)=>{beforeEdit?.();beforeEdit=undefined;const next=fn(structuredClone(raw[entry.options.id]),structuredClone(base[entry.options.id]));raw[entry.options.id]=next;revisions[entry.options.id]++;writes.push({id:entry.options.id,ops:[],via:'editor'})}}
  const forms:any={describe:()=>rows.filter(row=>row.entry.options.id!=='default-entry').map(row=>({ns:row.entry.options.id,value:unpack(row.entry.fiber.config),revision:revisions[row.entry.options.id]})),mutate:async(id:string,ops:any[],revision:number)=>{if(revision!==revisions[id])throw Error('SETTINGS_CONFLICT');apply(id,ops);writes.push({id,ops,via:'forms'})}}
  const settings=new DesktopSettings(editor,forms)
  return {raw,base,revisions,rows,editor,forms,settings,writes,beforeEdit:(fn:()=>void)=>{beforeEdit=fn},fail:(id:string)=>{failOwner=id}}
}
