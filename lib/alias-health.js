import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withFileLock } from '@deepseek-ai/dsh-atomic-write';
import { modelKey } from './domain.js';
export const DEFAULT_RECOVERY = { transientCooldownSeconds: 60, rateLimitCooldownSeconds: 300, quotaCooldownSeconds: 3600 };
export function recoveryFailure(failure) {
    if (failure.code === 'QUOTA')
        return 'quota';
    if (failure.code === 'RATE_LIMIT' || failure.status === 429)
        return 'rate-limit';
    if (['AUTH', 'INVALID_CREDENTIAL', 'MISSING_CREDENTIAL'].includes(failure.code) || failure.status === 401 || failure.status === 403)
        return 'auth';
    if (['NETWORK', 'TRANSPORT', 'TIMEOUT', 'SERVER', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(failure.code) || failure.status === 408 || (failure.status ?? 0) >= 500)
        return 'transient';
    return undefined;
}
export class AliasHealthStore {
    dir;
    now;
    leases = new Map();
    tickets = new Map();
    signatures = new Map();
    closed = false;
    warning;
    primaryValid = false;
    state = { version: 1, revision: 0, entries: [] };
    constructor(dir, now = Date.now) {
        this.dir = dir;
        this.now = now;
    }
    get file() { return join(this.dir, 'alias-health.json'); }
    key(alias, model) { return `${alias}:${modelKey(model)}`; }
    async init() { await mkdir(this.dir, { recursive: true }); await this.read(); return this; }
    async read() {
        this.primaryValid = false;
        for (const file of [this.file, `${this.file}.bak`]) {
            try {
                const value = JSON.parse(await readFile(file, 'utf8'));
                if (value.version !== 1 || !Number.isSafeInteger(value.revision) || !Array.isArray(value.entries) || value.entries.some(e => !e.alias || !e.model?.providerId || !e.model?.modelId || !e.signature || !['transient', 'rate-limit', 'quota', 'auth'].includes(e.kind) || !Number.isFinite(e.failedAt) || e.retryAt !== undefined && !Number.isFinite(e.retryAt)))
                    throw Error('健康状态格式无效');
                this.state = value;
                this.primaryValid = file === this.file;
                return;
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    this.warning = '健康状态损坏；已尝试读取备份，不可验证条目已停用。';
            }
        }
        this.state = { version: 1, revision: 0, entries: [] };
    }
    async change(update) {
        if (this.closed)
            return;
        await withFileLock(this.file, async () => {
            if (this.closed)
                return;
            await this.read();
            const before = JSON.stringify(this.state);
            update(this.state);
            if (before === JSON.stringify(this.state))
                return;
            this.state.revision++;
            const temp = `${this.file}.${randomUUID()}.tmp`;
            await writeFile(temp, JSON.stringify(this.state), { mode: 0o600 });
            if (this.primaryValid)
                await copyFile(this.file, `${this.file}.bak`);
            await rename(temp, this.file);
        });
    }
    snapshot() {
        return { revisionToken: String(this.state.revision), entries: this.state.entries.map(({ signature: _private, ...entry }) => ({ ...structuredClone(entry), recovering: this.leases.has(this.key(entry.alias, entry.model)) })), ...(this.warning ? { warning: this.warning } : {}) };
    }
    async retain(valid) { await this.change(state => { state.entries = state.entries.filter(e => valid.has(this.key(e.alias, e.model))); }); }
    async eligible(alias, model, signature) {
        this.signatures.set(this.key(alias, model), signature);
        await this.change(state => { state.entries = state.entries.filter(e => this.key(e.alias, e.model) !== this.key(alias, model) || e.signature === signature); });
        const entry = this.state.entries.find(e => e.alias === alias && modelKey(e.model) === modelKey(model));
        if (!entry)
            return { allowed: true };
        if (!entry.retryAt || entry.retryAt > this.now())
            return { allowed: false, reason: entry.retryAt ? `冷却至 ${new Date(entry.retryAt).toISOString()}` : '凭据不可用，需更换或手动恢复' };
        return { allowed: !this.leases.has(this.key(alias, model)), reason: '另一个会话正在恢复该候选' };
    }
    claimRecovery(alias, model) {
        const key = this.key(alias, model);
        const entry = this.state.entries.find(e => this.key(e.alias, e.model) === key), recovering = !!entry;
        if (entry && (!entry.retryAt || entry.retryAt > this.now()))
            return undefined;
        if (this.closed || recovering && this.leases.has(key))
            return undefined;
        const token = randomUUID();
        this.tickets.set(token, key);
        if (recovering)
            this.leases.set(key, token);
        return token;
    }
    release(alias, model, token) { const key = this.key(alias, model); if (token)
        this.tickets.delete(token); if (token && this.leases.get(key) === token)
        this.leases.delete(key); }
    async recordSuccess(alias, model, signature, token) {
        if (this.tickets.get(token) !== this.key(alias, model) || this.closed)
            return;
        try {
            await this.change(state => { if (this.tickets.get(token) !== this.key(alias, model) || this.signatures.has(this.key(alias, model)) && this.signatures.get(this.key(alias, model)) !== signature)
                return; state.entries = state.entries.filter(e => e.alias !== alias || modelKey(e.model) !== modelKey(model) || e.signature !== signature); });
        }
        finally {
            this.release(alias, model, token);
        }
    }
    async recordFailure(alias, model, signature, failure, policy, token) {
        if (this.tickets.get(token) !== this.key(alias, model) || this.closed)
            return;
        const kind = recoveryFailure(failure);
        try {
            if (kind)
                await this.change(state => {
                    if (this.tickets.get(token) !== this.key(alias, model) || this.signatures.has(this.key(alias, model)) && this.signatures.get(this.key(alias, model)) !== signature)
                        return;
                    const values = { ...DEFAULT_RECOVERY, ...policy }, failedAt = this.now();
                    const seconds = kind === 'transient' ? values.transientCooldownSeconds : kind === 'quota' ? values.quotaCooldownSeconds : values.rateLimitCooldownSeconds;
                    const hint = failure.providerRetryAfterMs;
                    const ms = kind !== 'transient' && Number.isFinite(hint) && hint > 0 && Number.isSafeInteger(failedAt + hint) ? hint : seconds * 1000;
                    state.entries = state.entries.filter(e => e.alias !== alias || modelKey(e.model) !== modelKey(model));
                    state.entries.push({ alias, model: structuredClone(model), signature, kind, failedAt, ...(kind !== 'auth' ? { retryAt: failedAt + ms } : {}) });
                });
        }
        finally {
            this.release(alias, model, token);
        }
    }
    async reset(alias, expectedRevisionToken) {
        await this.change(state => { if (String(state.revision) !== expectedRevisionToken)
            throw Error('SETTINGS_CONFLICT'); state.entries = state.entries.filter(e => e.alias !== alias); });
        for (const key of this.leases.keys())
            if (key.startsWith(`${alias}:`))
                this.leases.delete(key);
        for (const [token, key] of this.tickets)
            if (key.startsWith(`${alias}:`))
                this.tickets.delete(token);
        return this.snapshot();
    }
    dispose() { this.closed = true; this.leases.clear(); this.tickets.clear(); this.signatures.clear(); }
}
export async function openAliasHealthStore(profileDataDir) { return new AliasHealthStore(profileDataDir).init(); }
