import type { LlmRuntime } from '@deepseek-ai/dsh-llm';
import type { SettingsProvider } from './desktop-settings.js';
import type { WebServer } from '@deepseek-ai/dsh-host-webserver';
import type { Context } from '@deepseek-ai/cordis';
import { type CredentialProvider } from '@deepseek-ai/dsh-credentials';
import { ModelManagerService } from './service.js';
import { type SourceDeps } from './source-connections.js';
interface Host {
    llm: LlmRuntime;
    settings: SettingsProvider;
    credentials?: CredentialProvider;
    webServer: WebServer;
    effect: Context['effect'];
}
export declare function registerOfficialSync(ctx: Host, service: ModelManagerService, sources?: SourceDeps): void;
export {};
