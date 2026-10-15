export declare function legacyAliasReliability(raw: unknown): {
    name: string;
    values: Record<string, unknown>;
}[];
export declare function cleanLegacyAliasReliability(raw: unknown): unknown;
export declare function rejectAliasReliability(config: {
    aliases: Record<string, {
        reliability?: unknown;
    }>;
}): void;
