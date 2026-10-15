import type { Context } from '@deepseek-ai/cordis';
import type { LlmRuntime } from '@deepseek-ai/dsh-llm';
import type { SettingsForms } from '@deepseek-ai/dsh-settings';
import type { ConfigEditor } from '@deepseek-ai/dsh-config-editor';
import type { TokenMeter } from '@deepseek-ai/dsh-token-meter';
import type { ToolRuntime } from '@deepseek-ai/dsh-tools';
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment';
import type { WebServer } from '@deepseek-ai/dsh-host-webserver';
import type { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { type CredentialProvider } from '@deepseek-ai/dsh-credentials';
import z from '@deepseek-ai/schemastery';
import { type ManagerConfig, type ModelRef, type ProbeSuggestion, type Verification } from './domain.js';
import { ModelManagerService, type ModelInputBridge } from './service.js';
export declare const name = "dsh-model-manager";
export declare const inject: string[];
export declare const Config: z<NoInfer<Partial<ManagerConfig>>, NoInfer<ManagerConfig>, "volatile">;
type Host = Context & {
    llm: LlmRuntime;
    settings: SettingsForms;
    configEditor: ConfigEditor;
    tokenMeter: TokenMeter;
    tools: ToolRuntime;
    attachments: AttachmentStore;
    webServer: WebServer;
    systemPrompt: SystemPrompt;
    credentials: CredentialProvider;
};
export declare function verify(llm: LlmRuntime, attachments: AttachmentStore, service: ModelManagerService, ref: ModelRef, kind: Verification['kind'], signal: AbortSignal): Promise<Verification>;
export interface ProbeResult {
    verifications: Verification[];
    suggestions: ProbeSuggestion[];
    cancelled: boolean;
    /** 宿主声明为「不支持」时是否已临时提权为支持并实测（无论成败都已恢复或尝试恢复）。 */
    elevated: boolean;
    /** 探测后恢复宿主原声明失败；面板中该模型的「宿主原生图片」可能停留在「支持」。 */
    restoreFailed: boolean;
    notes: string[];
    /**
     * 探测结束时 `llm-pi-ai` 的最新 revision：探测期间可能提权/还原各写一次，
     * 调用方必须用这个 token 发起后续宿主声明写入，否则会带着过期 revision 撞上 SETTINGS_CONFLICT。
     */
    nativeRevision?: number;
}
/**
 * 对一个模型执行图片能力探测。宿主在发出请求前会按模型声明把图片投影成文字占位，
 * 因此声明为「不支持」的模型必须先把宿主 input 声明临时提为支持再实测，否则探测永远得出「未观察到」。
 * 提权无论成败都会恢复原声明；提权失败时跳过探测并记录说明，避免把「图片未送达」误判成模型能力。
 */
export declare function probeModel(llm: LlmRuntime, attachments: AttachmentStore, service: ModelManagerService, inputBridge: ModelInputBridge, ref: ModelRef, nativeImage: 'yes' | 'no' | 'unknown', signal: AbortSignal): Promise<ProbeResult>;
export declare function apply(ctx: Host, entryConfig?: Partial<ManagerConfig>): void;
export {};
