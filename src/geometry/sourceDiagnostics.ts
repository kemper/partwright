import { javascriptLanguage } from '@codemirror/lang-javascript';
import type { SourceDiagnostic } from './types';

const MAX_SYNTAX_DIAGNOSTICS = 5;

interface ErrorWithLocation extends Error {
  lineNumber?: number;
  columnNumber?: number;
  /** The user's own line, set by the SES model compiler (sesSandbox.ts), whose
   *  wrapper doesn't shift lines — preferred over `lineNumber`. */
  modelLineNumber?: number;
}

function clampOffset(source: string, offset: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.max(0, Math.min(source.length, Math.trunc(offset)));
}

export function offsetToLocation(source: string, offset: number): { line: number; column: number } {
  const target = clampOffset(source, offset);
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < target; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: target - lineStart + 1 };
}

export function lineRange(source: string, line: number, column = 1): { from: number; to: number } {
  const targetLine = Math.max(1, Math.trunc(line || 1));
  let currentLine = 1;
  let lineStart = 0;

  for (let i = 0; i < source.length && currentLine < targetLine; i++) {
    if (source.charCodeAt(i) === 10) {
      currentLine++;
      lineStart = i + 1;
    }
  }

  if (currentLine !== targetLine) {
    return { from: source.length, to: source.length };
  }

  let lineEnd = source.indexOf('\n', lineStart);
  if (lineEnd === -1) lineEnd = source.length;

  const from = clampOffset(source, lineStart + Math.max(0, Math.trunc(column || 1) - 1));
  return { from: Math.min(from, lineEnd), to: Math.max(Math.min(lineEnd, from + 1), from) };
}

function expandRange(source: string, from: number, to: number): { from: number; to: number } {
  const start = clampOffset(source, from);
  const end = clampOffset(source, to);
  if (end > start) return { from: start, to: end };
  if (start < source.length && source[start] !== '\n') return { from: start, to: start + 1 };
  if (start > 0) return { from: start - 1, to: start };
  return { from: start, to: start };
}

function syntaxHint(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('unexpected token') || lower.includes('unexpected identifier')) {
    return 'Check just before this location for a missing comma, operator, value, or closing delimiter.';
  }
  if (lower.includes('missing )') || lower.includes('unexpected end')) {
    return 'Check for an unclosed parenthesis, bracket, brace, string, or template literal above this line.';
  }
  if (lower.includes('invalid or unexpected token')) {
    return 'Check for an extra character, a bad quote, or an unterminated string.';
  }
  if (lower.includes('strict mode')) {
    return 'The editor code runs as a strict JavaScript function body.';
  }
  return 'Fix the highlighted syntax, then run the model again.';
}

function firstUsefulLine(message: string): string {
  const lines = message
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.includes('Could not initialize localization'));
  return lines.find(line => /^ERROR\b/i.test(line)) ?? lines[0] ?? message;
}

export function javaScriptSyntaxDiagnostics(source: string, message: string, error?: unknown): SourceDiagnostic[] {
  const diagnostics: SourceDiagnostic[] = [];
  const tree = javascriptLanguage.parser.parse(source);

  tree.cursor().iterate((node) => {
    if (!node.type.isError || diagnostics.length >= MAX_SYNTAX_DIAGNOSTICS) return;
    const { from, to } = expandRange(source, node.from, node.to);
    const loc = offsetToLocation(source, from);
    const endLoc = offsetToLocation(source, to);
    diagnostics.push({
      message: diagnostics.length === 0 ? message : 'Additional syntax issue near this location.',
      severity: 'error',
      source: 'JavaScript',
      hint: syntaxHint(message),
      from,
      to,
      line: loc.line,
      column: loc.column,
      endLine: endLoc.line,
      endColumn: endLoc.column,
    });
  });

  if (diagnostics.length > 0) return diagnostics;

  const locatedError = error instanceof Error ? error as ErrorWithLocation : null;
  if (locatedError?.modelLineNumber || locatedError?.lineNumber) {
    // The legacy Function constructor prepends `"use strict";\n`, so
    // browser-provided line numbers for that generated body are one line
    // higher than user code. The SES compiler reports the user's line as-is.
    const line = locatedError.modelLineNumber
      ? Math.max(1, locatedError.modelLineNumber)
      : Math.max(1, (locatedError.lineNumber ?? 1) - 1);
    const column = locatedError.modelLineNumber ? 1 : Math.max(1, locatedError.columnNumber ?? 1);
    const { from, to } = lineRange(source, line, column);
    const loc = offsetToLocation(source, from);
    return [{
      message,
      severity: 'error',
      source: 'JavaScript',
      hint: syntaxHint(message),
      from,
      to,
      line: loc.line,
      column: loc.column,
    }];
  }

  return [{
    message,
    severity: 'error',
    source: 'JavaScript',
    hint: syntaxHint(message),
  }];
}

export function scadDiagnostics(source: string, message: string): SourceDiagnostic[] {
  const lineMatch = message.match(/\bline\s+(\d+)(?:\s*,\s*column\s+(\d+))?/i);
  const line = lineMatch ? Number(lineMatch[1]) : undefined;
  const column = lineMatch?.[2] ? Number(lineMatch[2]) : 1;
  const diagnosticMessage = firstUsefulLine(message);

  if (!line) {
    return [{
      message: diagnosticMessage,
      severity: 'error',
      source: 'OpenSCAD',
      hint: 'Check the OpenSCAD error output and the most recent edit.',
    }];
  }

  const { from, to } = lineRange(source, line, column);
  const loc = offsetToLocation(source, from);
  const endLoc = offsetToLocation(source, to);
  return [{
    message: diagnosticMessage,
    severity: 'error',
    source: 'OpenSCAD',
    hint: 'Check this line and the line above it for missing punctuation or an unclosed delimiter.',
    from,
    to,
    line: loc.line,
    column: loc.column,
    endLine: endLoc.line,
    endColumn: endLoc.column,
  }];
}

export function runtimeDiagnostic(message: string, hint?: string, source = 'Runtime'): SourceDiagnostic[] {
  return [{
    message,
    severity: 'error',
    source,
    hint,
  }];
}
