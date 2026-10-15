import type { ConfigEditor } from '@deepseek-ai/dsh-config-editor';
import type { SettingsForms, SettingsPathOp } from '@deepseek-ai/dsh-settings';
export type { SettingsPathOp } from '@deepseek-ai/dsh-settings';
export interface SettingsDescriptor {
    ns: string;
    value: unknown;
    user?: unknown;
    base?: unknown;
    revision: number;
}
/** Internal configuration port; never calls the removed host SettingsProvider API. */
export interface SettingsProvider {
    writable?: boolean;
    namespaceFor?(entryId: string): string;
    get(ns: string): unknown;
    describe(options?: {
        redactSecrets?: boolean;
    }): SettingsDescriptor[];
    mutate(ns: string, operations: readonly SettingsPathOp[], revision: number): Promise<void>;
    replace(ns: string, value: unknown, revision: number): Promise<void>;
}
export declare function unpack(value: any): any;
export declare const revisionToken: (value: unknown) => string;
export declare class DesktopSettings implements SettingsProvider {
    readonly editor: ConfigEditor;
    private readonly forms;
    readonly writable = true;
    private revisions;
    private sequence;
    isBusy: () => boolean;
    constructor(editor: ConfigEditor, forms: SettingsForms);
    row(ns: string): {
        entry: import("@deepseek-ai/cordis-plugin-loader").Entry;
        inherited: Record<string, unknown>;
        override: Record<string, unknown>;
    };
    namespaceFor(entryId: string): string;
    private descriptor;
    get(ns: string): unknown;
    describe(_options?: {
        redactSecrets?: boolean;
    }): SettingsDescriptor[];
    mutate(ns: string, operations: readonly SettingsPathOp[], expected: number): Promise<void>;
    replace(ns: string, value: unknown, expected: number): Promise<void>;
}
export declare function describeOwners(ctx: {
    configEditor: ConfigEditor;
    settings: SettingsForms;
}): {
    owner: string;
    entryId: string;
    revisionToken: string;
    writable: boolean;
    applies: string;
    fields: never[];
}[];
export declare function applyOwner(ctx: {
    configEditor: ConfigEditor;
    settings: SettingsForms;
}, entryId: string, expectedRevisionToken: string, operations: readonly SettingsPathOp[]): Promise<{
    owner: string;
    entryId: string;
    revisionToken: string;
    writable: boolean;
    applies: string;
    fields: never[];
} | undefined>;
