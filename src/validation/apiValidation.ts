// Runtime type/shape validation for the window.partwright API. The public
// API is reachable from untyped callers (browser console, MCP-driven AI
// agents, automation scripts) so TypeScript's compile-time guarantees do
// not apply. These helpers enforce argument contracts explicitly, with
// chatty error messages pointing at /ai.md anchors so AI callers can
// self-correct.
//
// Convention:
//   • Methods that already return a value use { error: "..." } on failure
//     (wrap the validation call in guard()).
//   • Void setters THROW so misuse is loud.
//   • No coercion — "5" is not a number; wrong types are rejected outright.

/** Thrown by assertion helpers on validation failure. Void setters let this
 *  propagate; value-returning methods catch via guard(). */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function describeValue(val: unknown): string {
  if (val === null) return 'null';
  if (val === undefined) return 'undefined';
  if (Array.isArray(val)) return `array(length=${val.length})`;
  if (typeof val === 'object') return 'object';
  if (typeof val === 'string') return `string("${val.length > 40 ? val.slice(0, 40) + '…' : val}")`;
  return `${typeof val}(${String(val)})`;
}

/** Run a validation function; if it throws ValidationError, return { error } instead. */
export function guard<T>(fn: () => T): T | { error: string } {
  try {
    return fn();
  } catch (e: unknown) {
    if (e instanceof ValidationError) return { error: e.message };
    throw e;
  }
}

export interface AssertStringOpts { optional?: boolean; allowEmpty?: boolean }
export function assertString(val: unknown, paramName: string, opts: AssertStringOpts = {}): string | undefined {
  if (val === undefined || val === null) {
    if (opts.optional) return undefined;
    throw new ValidationError(`${paramName} is required (expected string, got ${describeValue(val)}). See /ai.md#argument-validation`);
  }
  if (typeof val !== 'string') {
    throw new ValidationError(`${paramName} must be a string, got ${describeValue(val)}. See /ai.md#argument-validation`);
  }
  if (!opts.allowEmpty && val.length === 0) {
    throw new ValidationError(`${paramName} must not be an empty string. See /ai.md#argument-validation`);
  }
  return val;
}

export interface AssertNumberOpts { optional?: boolean; min?: number; max?: number; integer?: boolean }
export function assertNumber(val: unknown, paramName: string, opts: AssertNumberOpts = {}): number | undefined {
  if (val === undefined || val === null) {
    if (opts.optional) return undefined;
    throw new ValidationError(`${paramName} is required (expected number, got ${describeValue(val)}). See /ai.md#argument-validation`);
  }
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    throw new ValidationError(`${paramName} must be a finite number, got ${describeValue(val)}. See /ai.md#argument-validation`);
  }
  if (opts.integer && !Number.isInteger(val)) {
    throw new ValidationError(`${paramName} must be an integer, got ${val}. See /ai.md#argument-validation`);
  }
  if (opts.min !== undefined && val < opts.min) {
    throw new ValidationError(`${paramName} must be >= ${opts.min}, got ${val}. See /ai.md#argument-validation`);
  }
  if (opts.max !== undefined && val > opts.max) {
    throw new ValidationError(`${paramName} must be <= ${opts.max}, got ${val}. See /ai.md#argument-validation`);
  }
  return val;
}

export interface AssertBooleanOpts { optional?: boolean }
export function assertBoolean(val: unknown, paramName: string, opts: AssertBooleanOpts = {}): boolean | undefined {
  if (val === undefined || val === null) {
    if (opts.optional) return undefined;
    throw new ValidationError(`${paramName} is required (expected boolean, got ${describeValue(val)}). See /ai.md#argument-validation`);
  }
  if (typeof val !== 'boolean') {
    throw new ValidationError(`${paramName} must be a boolean, got ${describeValue(val)}. See /ai.md#argument-validation`);
  }
  return val;
}

export interface AssertObjectOpts { optional?: boolean }
export function assertObject(val: unknown, paramName: string, opts: AssertObjectOpts = {}): Record<string, unknown> | undefined {
  if (val === undefined || val === null) {
    if (opts.optional) return undefined;
    throw new ValidationError(`${paramName} is required (expected object, got ${describeValue(val)}). See /ai.md#argument-validation`);
  }
  if (typeof val !== 'object' || Array.isArray(val)) {
    throw new ValidationError(`${paramName} must be a plain object (not array/null), got ${describeValue(val)}. See /ai.md#argument-validation`);
  }
  return val as Record<string, unknown>;
}

export function assertFunction(val: unknown, paramName: string): (...args: unknown[]) => unknown {
  if (typeof val !== 'function') {
    throw new ValidationError(`${paramName} must be a function, got ${describeValue(val)}. See /ai.md#argument-validation`);
  }
  return val as (...args: unknown[]) => unknown;
}

export function assertEnum<T extends string>(val: unknown, allowed: readonly T[], paramName: string): T {
  if (typeof val !== 'string' || !allowed.includes(val as T)) {
    throw new ValidationError(`${paramName} must be one of: ${allowed.map(a => `"${a}"`).join(' | ')}. Got ${describeValue(val)}. See /ai.md#argument-validation`);
  }
  return val as T;
}

/** Validate a fixed-length tuple of numbers (e.g. [x,y,z]). */
export function assertNumberTuple(val: unknown, length: number, paramName: string): number[] {
  if (!Array.isArray(val)) {
    throw new ValidationError(`${paramName} must be an array of ${length} numbers, got ${describeValue(val)}. See /ai.md#argument-validation`);
  }
  if (val.length !== length) {
    throw new ValidationError(`${paramName} must have exactly ${length} elements, got length=${val.length}. See /ai.md#argument-validation`);
  }
  for (let i = 0; i < length; i++) {
    if (typeof val[i] !== 'number' || !Number.isFinite(val[i])) {
      throw new ValidationError(`${paramName}[${i}] must be a finite number, got ${describeValue(val[i])}. See /ai.md#argument-validation`);
    }
  }
  return val as number[];
}

export function assertArray(val: unknown, paramName: string): unknown[] {
  if (!Array.isArray(val)) {
    throw new ValidationError(`${paramName} must be an array, got ${describeValue(val)}. See /ai.md#argument-validation`);
  }
  return val;
}

/** Reject any keys on `obj` that are not in the `allowed` set.
 *  Catches typos like `{ widthToDeep: [1,2] }` that would otherwise be silently ignored. */
export function assertNoUnknownKeys(obj: Record<string, unknown>, allowed: readonly string[], paramName: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new ValidationError(`${paramName}.${key} is not a recognized field. Allowed: ${allowed.join(', ')}. See /ai.md#argument-validation`);
    }
  }
}

/** Validate a GeometryAssertions object shape. Throws ValidationError on failure. */
const ASSERTION_FIELDS = [
  'minVolume', 'maxVolume', 'isManifold', 'maxComponents', 'genus', 'minGenus', 'maxGenus',
  'minBounds', 'maxBounds', 'minTriangles', 'maxTriangles', 'boundsRatio', 'notes',
] as const;
const BOUNDS_RATIO_FIELDS = ['widthToDepth', 'widthToHeight', 'depthToHeight'] as const;

export function validateAssertionsShape(assertions: unknown, paramName: string): void {
  const a = assertObject(assertions, paramName)!;
  assertNoUnknownKeys(a, ASSERTION_FIELDS, paramName);
  assertNumber(a.minVolume, `${paramName}.minVolume`, { optional: true });
  assertNumber(a.maxVolume, `${paramName}.maxVolume`, { optional: true });
  assertBoolean(a.isManifold, `${paramName}.isManifold`, { optional: true });
  assertNumber(a.maxComponents, `${paramName}.maxComponents`, { optional: true, min: 0, integer: true });
  assertNumber(a.genus, `${paramName}.genus`, { optional: true, integer: true });
  assertNumber(a.minGenus, `${paramName}.minGenus`, { optional: true, integer: true });
  assertNumber(a.maxGenus, `${paramName}.maxGenus`, { optional: true, integer: true });
  if (a.minBounds !== undefined) assertNumberTuple(a.minBounds, 3, `${paramName}.minBounds`);
  if (a.maxBounds !== undefined) assertNumberTuple(a.maxBounds, 3, `${paramName}.maxBounds`);
  assertNumber(a.minTriangles, `${paramName}.minTriangles`, { optional: true, min: 0, integer: true });
  assertNumber(a.maxTriangles, `${paramName}.maxTriangles`, { optional: true, min: 0, integer: true });
  assertString(a.notes, `${paramName}.notes`, { optional: true, allowEmpty: true });
  if (a.boundsRatio !== undefined) {
    const br = assertObject(a.boundsRatio, `${paramName}.boundsRatio`)!;
    assertNoUnknownKeys(br, BOUNDS_RATIO_FIELDS, `${paramName}.boundsRatio`);
    for (const k of BOUNDS_RATIO_FIELDS) {
      if (br[k] !== undefined) assertNumberTuple(br[k], 2, `${paramName}.boundsRatio.${k}`);
    }
  }
}
