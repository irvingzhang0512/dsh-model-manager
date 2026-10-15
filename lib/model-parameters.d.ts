import { type HostModel } from './official-state.js';
import { type ModelRef } from './domain.js';
import type { CatalogIntent, CatalogPreview, CatalogState } from './catalog-types.js';
import type { OfficialEvidence, OfficialPage } from './official-types.js';
export type ParameterValueSource = 'user' | 'catalog' | 'provider-default' | 'runtime-default' | 'unknown';
export interface ParameterFieldDescriptor {
    field: string[];
    label: string;
    schema: Record<string, unknown>;
    writable: boolean;
    reason?: string;
    effect?: string;
}
export interface ModelParameterTarget {
    model: ModelRef;
    name: string;
    api: string;
    writable: boolean;
    reason?: string;
    fields: ParameterFieldDescriptor[];
    currentValues: Record<string, unknown>;
    currentSources: Record<string, ParameterValueSource>;
}
export interface ParameterSuggestion {
    id: string;
    model: ModelRef;
    field: string[];
    label?: string;
    currentValue?: unknown;
    currentSource: ParameterValueSource;
    value?: unknown;
    basis: 'official' | 'knowledge' | 'unknown';
    reason: string;
    evidence: OfficialEvidence[];
    writable: boolean;
    blockedReason?: string;
    effect?: string;
}
export interface ParameterModelResult {
    model: ModelRef;
    status: 'ready' | 'no-change' | 'failed' | 'unsupported';
    suggestions: ParameterSuggestion[];
    notes: string[];
}
export interface ParameterAnalysis {
    analyzer: ModelRef;
    reasoningEffort?: string;
    analysisTimeoutSeconds: number;
    searchCount: number;
    analysisCount: number;
    results: ParameterModelResult[];
}
export interface ModelParameterPreview extends CatalogPreview {
    parameterAnalysis: ParameterAnalysis;
    selectedFields: string[];
}
export type HostParameterCatalog = Record<string, Record<string, HostModel>>;
export declare const fieldKey: (field: string[]) => string;
export declare const object: (value: unknown) => value is Record<string, unknown>;
export declare function fieldAt(value: unknown, path: string[]): unknown;
export declare function setField(value: Record<string, unknown>, path: string[], next: unknown): void;
export declare const effortLevels: string[];
export declare function compatFields(api: string): string[];
export declare function parameterFields(ns: string, api: string): ParameterFieldDescriptor[];
export declare function validateParameterModel(model: HostModel, ns: string, api: string): void;
export declare function describeParameterTargets(state: CatalogState, hostCatalog: HostParameterCatalog): ModelParameterTarget[];
export declare function validateParameterSuggestions(value: unknown, target: ModelParameterTarget, pages: OfficialPage[]): ParameterSuggestion[];
export declare function defaultParameterFields(analysis: ParameterAnalysis): string[];
export declare function parameterIntents(state: CatalogState, analysis: ParameterAnalysis, selectedFields: string[]): CatalogIntent[];
