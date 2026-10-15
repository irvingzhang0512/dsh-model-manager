import { defineTool, type ToolRuntime } from '@deepseek-ai/dsh-tools'
import type { VisionRegistry } from './adapter.js'
import { analyzeImage, type VisionDeps } from './vision-analysis.js'

export function registerManagerTools(deps: VisionDeps & { tools: ToolRuntime; vision: VisionRegistry }): () => void {
  return deps.tools.register(defineTool({
    name: 'model_manager_inspect_image',
    description: '查看当前会话中图片附件的原图，可继续针对同一附件追问。仅使用模型管理提供的附件 ID。',
    parameters: {
      attachment_id: { type:'string',required:true }, question: { type:'string',required:true },
      region: { type:'string',description:'可选裁剪区域：归一化 x,y,width,height，例如 0.25,0.25,0.5,0.5。' },
    },
    output: { schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}] },
    execute: async (args,exec) => {
      const session = exec.agent?.session.id as string || 'one-shot'
      const ref = deps.vision.get(session,args.attachment_id)
      if (!ref) throw Error('附件不属于当前会话或引用已过期')
      return (await analyzeImage(session,ref,args.question,args.region,exec.signal,deps)).answer
    },
  }))
}
