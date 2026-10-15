import type {GenerateOptions, StreamChunk} from '@deepseek-ai/dsh-llm'
import type {ModelRef} from './domain.js'
export function wrapReplay(chunk:StreamChunk,ref:ModelRef):StreamChunk {
  if(chunk.type!=='finish' || !chunk.replayState)return chunk
  return {...chunk,replayState:{...chunk.replayState,response:{$dmm:1,provider:ref.providerId,model:ref.modelId,state:chunk.replayState.response}}}
}
export function unwrapReplay(messages:GenerateOptions['messages']):GenerateOptions['messages'] {
  return messages.map(message=>{
    if(message.role!=='assistant' || message.source.provider!=='dsh-model-manager')return message
    const replay=message.source.replayState as {response?:{$dmm?:number;provider?:string;model?:string;state?:unknown};blocks?:readonly unknown[]} | undefined
    const response=replay?.response
    if(response?.$dmm!==1 || typeof response.provider!=='string' || typeof response.model!=='string')return message
    return {...message,source:{kind:'model' as const,provider:response.provider,model:response.model,replayState:{response:response.state,...(replay?.blocks===undefined?{}:{blocks:replay.blocks})}}}
  })
}
