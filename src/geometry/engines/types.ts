import type { MeshData, MeshResult, SourceDiagnostic } from '../types';

export type Language = 'manifold-js' | 'scad' | 'replicad';

export const DEFAULT_LANGUAGE: Language = 'manifold-js';

/** Languages the app exposes to users, in the order shown in pickers. The
 *  default (manifold-js) goes first because it's eager-loaded and has the
 *  broadest feature surface; everything after it is lazy. */
export const ALL_LANGUAGES: readonly Language[] = ['manifold-js', 'scad', 'replicad'] as const;

export function isLanguage(v: unknown): v is Language {
  return v === 'manifold-js' || v === 'scad' || v === 'replicad';
}

/** Short label for UI badges and the editor title. */
export function languageDisplay(lang: Language): string {
  switch (lang) {
    case 'manifold-js': return 'JS';
    case 'scad': return 'SCAD';
    case 'replicad': return 'BREP';
  }
}

export interface ValidateResult {
  valid: boolean;
  error?: string;
  diagnostics?: SourceDiagnostic[];
}

export interface Engine {
  id: Language;
  /** Initialize the engine. Idempotent. */
  init(): Promise<void>;
  /** Is the engine initialized and ready? */
  isReady(): boolean;
  /** Run source code; return mesh + (optional) manifold handle or error.
   * Requires init() to have completed — throws/errors if not ready. */
  run(source: string): MeshResult;
  /** Best-effort syntax/compile check. */
  validate(source: string): ValidateResult;
}

export type { MeshData, MeshResult, SourceDiagnostic };
