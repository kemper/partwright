import type { Engine, MeshResult, ValidateResult } from './types';
import { javaScriptSyntaxDiagnostics, runtimeDiagnostic } from '../sourceDiagnostics';
import { createCurvesNamespace } from '../curves';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let manifoldModule: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let curvesNamespace: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getManifoldModule(): any {
  return manifoldModule;
}

export const manifoldJsEngine: Engine = {
  id: 'manifold-js',

  async init() {
    if (manifoldModule) return;
    const Module = await import('manifold-3d');
    manifoldModule = await Module.default();
    manifoldModule.setup();
    curvesNamespace = createCurvesNamespace(manifoldModule);
  },

  isReady() {
    return manifoldModule !== null;
  },

  run(jsCode: string): MeshResult {
    if (!manifoldModule) {
      return { mesh: null, manifold: null, error: 'Engine not initialized' };
    }

    const {
      Manifold,
      CrossSection,
      setMinCircularAngle,
      setMinCircularEdgeLength,
      setCircularSegments,
    } = manifoldModule;

    const api = {
      Manifold,
      CrossSection,
      Curves: curvesNamespace,
      setMinCircularAngle,
      setMinCircularEdgeLength,
      setCircularSegments,
    };

    let result: InstanceType<typeof Manifold> | null = null;
    try {
      const fn = new Function('api', `"use strict";\n${jsCode}`);
      result = fn(api);

      if (!result || typeof result.getMesh !== 'function') {
        const error = 'Code must return a Manifold object. Did you forget to `return` the final Manifold? See /ai.md#before-you-start';
        return {
          mesh: null,
          manifold: null,
          error,
          diagnostics: runtimeDiagnostic(error, 'Add a final `return` statement that returns the Manifold you want to render.', 'JavaScript'),
        };
      }

      const mesh = result.getMesh();
      return {
        mesh: {
          vertProperties: mesh.vertProperties,
          triVerts: mesh.triVerts,
          numVert: mesh.numVert,
          numTri: mesh.numTri,
          numProp: mesh.numProp,
          mergeFromVert: mesh.mergeFromVert,
          mergeToVert: mesh.mergeToVert,
        },
        manifold: result,
        error: null,
      };
    } catch (e: unknown) {
      let msg = e instanceof Error ? e.message : String(e);
      const isSyntaxError = e instanceof SyntaxError;
      let hint: string | undefined;

      // Enhance common WASM error messages with actionable hints
      if (msg.includes('BindingError') && msg.includes('deleted object')) {
        hint = 'A Manifold or CrossSection was used after being deleted. Avoid calling .delete() on objects you still need, or store intermediate results before cleanup.';
      } else if (msg.includes('function _Cylinder called with')) {
        hint = 'Manifold.cylinder(height, radiusLow, radiusHigh?, segments?) — check argument count and order.';
      } else if (msg.includes('function _Cube called with')) {
        hint = 'Manifold.cube([x, y, z], center?) — first arg must be an array of 3 numbers.';
      } else if (msg.includes('Missing field')) {
        hint = 'You may have passed an array where an object was expected, or vice versa. Check the API signature.';
      } else if (msg.includes('unreachable') || msg.includes('RuntimeError')) {
        hint = 'WASM runtime error — likely caused by degenerate geometry, a self-intersection, or an invalid boolean. Try simplifying the operation or checking input dimensions.';
      }

      if (hint) msg += `\nHint: ${hint}`;
      return {
        mesh: null,
        manifold: null,
        error: msg,
        diagnostics: isSyntaxError ? javaScriptSyntaxDiagnostics(jsCode, msg, e) : runtimeDiagnostic(msg, hint, 'JavaScript'),
      };
    }
  },

  validate(jsCode: string): ValidateResult {
    // Cheap parse check — try to construct the Function without executing.
    try {
      new Function('api', `"use strict";\n${jsCode}`);
      return { valid: true };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      return {
        valid: false,
        error,
        diagnostics: e instanceof SyntaxError ? javaScriptSyntaxDiagnostics(jsCode, error, e) : runtimeDiagnostic(error, undefined, 'JavaScript'),
      };
    }
  },
};
