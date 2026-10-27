// Fit the parametric human's body sliders to a photo's silhouette. Pure: the
// caller supplies the scorer (build the model, render it, compare with the
// photo — the CLI does this with the photo-match scorer, the same one as
// `partwright.photoMatch`), so the search runs anywhere.
//
// The search is a bounded coordinate descent: try each dimension a step up
// and down, keep what improves the score, halve the steps when a sweep finds
// nothing, stop at the evaluation budget. Silhouette scores are noisy and
// non-smooth (pixels flip), which suits a derivative-free search, and a dozen
// dimensions converge in a few dozen builds.

/** One fittable slider: where it lives in the api.human options, and its range. */
export interface FitDim {
  key: string;
  /** Path into the options, e.g. ['body', 'weight'] or ['morphs', 'hip-scale-horiz']. */
  path: string[];
  min: number;
  max: number;
  /** First trial step. */
  step: number;
  /** Starting value when the base options don't set one. */
  start: number;
}

/** The dimensions a full-body photo can inform, by name. */
export const FIT_DIMS: Record<string, FitDim> = {
  gender: { key: 'gender', path: ['body', 'gender'], min: 0, max: 1, step: 0.25, start: 0.5 },
  weight: { key: 'weight', path: ['body', 'weight'], min: 0, max: 1, step: 0.2, start: 0.5 },
  muscle: { key: 'muscle', path: ['body', 'muscle'], min: 0, max: 1, step: 0.2, start: 0.5 },
  age: { key: 'age', path: ['body', 'age'], min: 3, max: 80, step: 12, start: 25 },
  breast: { key: 'breast', path: ['body', 'breast'], min: 0, max: 1, step: 0.25, start: 0.5 },
  vShape: { key: 'vShape', path: ['torso', 'vShape'], min: -1, max: 1, step: 0.4, start: 0 },
  belly: { key: 'belly', path: ['torso', 'belly'], min: -1, max: 1, step: 0.4, start: 0 },
  shoulders: { key: 'shoulders', path: ['morphs', 'torso-scale-horiz'], min: -1, max: 1, step: 0.4, start: 0 },
  hips: { key: 'hips', path: ['morphs', 'hip-scale-horiz'], min: -1, max: 1, step: 0.4, start: 0 },
  legs: { key: 'legs', path: ['morphs', 'upperlegs-height'], min: -1, max: 1, step: 0.4, start: 0 },
  head: { key: 'head', path: ['morphs', 'head-scale-vert'], min: -1, max: 1, step: 0.4, start: 0 },
  headWidth: { key: 'headWidth', path: ['morphs', 'head-scale-horiz'], min: -1, max: 1, step: 0.4, start: 0 },
  armL: { key: 'armL', path: ['pose', 'armL', 'raiseSide'], min: 0, max: 100, step: 20, start: 8 },
  armR: { key: 'armR', path: ['pose', 'armR', 'raiseSide'], min: 0, max: 100, step: 20, start: 8 },
  legSpread: { key: 'legSpread', path: ['pose', 'legL', 'raiseSide'], min: 0, max: 25, step: 6, start: 0 },
};

/** What a front photo of a standing person constrains well. */
export const DEFAULT_FIT = ['gender', 'weight', 'muscle', 'vShape', 'shoulders', 'hips', 'legs', 'head', 'armL', 'armR', 'legSpread'];

type Options = Record<string, unknown>;

function getPath(o: Options, path: string[]): unknown {
  let cur: unknown = o;
  for (const k of path) { if (!cur || typeof cur !== 'object') return undefined; cur = (cur as Record<string, unknown>)[k]; }
  return cur;
}

/** A copy of `base` with each dimension's value written at its path. The
 *  legs' spread is mirrored onto the right leg so the stance stays symmetric. */
export function applyDims(base: Options, dims: FitDim[], values: number[]): Options {
  const out = JSON.parse(JSON.stringify(base)) as Options;
  dims.forEach((d, i) => {
    const paths = d.key === 'legSpread' ? [d.path, ['pose', 'legR', 'raiseSide']] : [d.path];
    for (const path of paths) {
      let cur = out as Record<string, unknown>;
      for (const k of path.slice(0, -1)) {
        if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
        cur = cur[k] as Record<string, unknown>;
      }
      cur[path[path.length - 1]] = Math.round(values[i] * 1000) / 1000;
    }
  });
  return out;
}

/** Each dimension's starting value: the base options' own, else its default. */
export function startValues(base: Options, dims: FitDim[]): number[] {
  return dims.map((d) => {
    const v = getPath(base, d.path);
    return typeof v === 'number' ? Math.min(d.max, Math.max(d.min, v)) : d.start;
  });
}

/** The model source for a set of options. */
export function humanCode(options: Options): string {
  return `return api.human(${JSON.stringify(options, null, 2)});\n`;
}

export interface FitStep { values: number[]; score: number }
export interface FitResult { values: number[]; score: number; evaluations: number; history: FitStep[] }

/** Bounded coordinate descent maximising `score`. */
export async function fitCoordinateDescent(
  dims: FitDim[], start: number[], score: (values: number[]) => Promise<number>,
  opts: { budget?: number; minStepFraction?: number; onStep?: (s: FitStep) => void } = {},
): Promise<FitResult> {
  const budget = opts.budget ?? 60;
  const minFrac = opts.minStepFraction ?? 1 / 16;
  const clampDim = (i: number, v: number) => Math.min(dims[i].max, Math.max(dims[i].min, v));
  let best = start.map((v, i) => clampDim(i, v));
  let bestScore = await score(best);
  let evaluations = 1;
  const history: FitStep[] = [{ values: best, score: bestScore }];
  opts.onStep?.(history[0]);
  const steps = dims.map((d) => d.step);
  const seen = new Map<string, number>([[best.join(','), bestScore]]);
  while (evaluations < budget) {
    let improved = false;
    for (let i = 0; i < dims.length && evaluations < budget; i++) {
      for (const dir of [1, -1]) {
        if (evaluations >= budget) break;
        const cand = best.slice();
        cand[i] = clampDim(i, best[i] + dir * steps[i]);
        if (cand[i] === best[i]) continue;
        const key = cand.join(',');
        let s = seen.get(key);
        if (s === undefined) { s = await score(cand); evaluations++; seen.set(key, s); }
        if (s > bestScore) {
          best = cand; bestScore = s; improved = true;
          const step = { values: best, score: bestScore };
          history.push(step);
          opts.onStep?.(step);
          break;
        }
      }
    }
    if (!improved) {
      if (steps.every((s, i) => s <= dims[i].step * minFrac)) break;
      for (let i = 0; i < steps.length; i++) steps[i] /= 2;
    }
  }
  return { values: best, score: bestScore, evaluations, history };
}


/**
 * Silhouette IoU of two normalised label maps (< -1 = background, as the
 * photo-match debug maps), maximised over a horizontal shift of up to
 * `maxShift` pixels. The photo-match scorer centres each silhouette on its
 * bounding box, so raising ONE arm moves the whole body sideways and the
 * plain IoU collapses; re-aligning makes the score smooth in the pose.
 */
export function shiftedIoU(photo: Int32Array, model: Int32Array, width: number, height: number, maxShift: number): number {
  let best = 0;
  for (let dx = -maxShift; dx <= maxShift; dx++) {
    let inter = 0, union = 0;
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        const p = photo[row + x] > -2;
        const mx = x - dx;
        const m = mx >= 0 && mx < width && model[row + mx] > -2;
        if (p && m) inter++;
        if (p || m) union++;
      }
    }
    if (union && inter / union > best) best = inter / union;
  }
  return best;
}

/** Largest sideways re-alignment `fitSilhouetteIoU` tries, as a fraction of
 *  the canvas width (an algorithm bound, like the photo-match band count). */
const FIT_MAX_SHIFT = 0.12;

/** The fit's per-view score from a photo-match `debug` result: the
 *  silhouettes' IoU, re-aligned over a small sideways shift. Shared by the
 *  CLI (`npm run human:fit`) and the browser (`partwright.fitHuman`). */
export function fitSilhouetteIoU(debug: { width: number; height: number; photo: Int32Array; model: Int32Array }): number {
  return shiftedIoU(debug.photo, debug.model, debug.width, debug.height, Math.round(debug.width * FIT_MAX_SHIFT));
}

/** Below this share of the photo's silhouette in one connected piece, the
 *  background segmentation has probably lost part of the person. */
const FIT_MIN_MAIN_SHARE = 0.85;

/**
 * Checks on the photo's silhouette (the photo side of a photo-match `debug`
 * result): a person is one connected shape, so a silhouette in pieces means
 * the segmentation lost part of them against a busy background (dark clothes
 * against dark furniture) and the fit will chase the wrong outline. Returns
 * plain-words warnings, empty when it looks whole.
 */
export function photoSilhouetteWarnings(debug: { width: number; height: number; photo: Int32Array }): string[] {
  const { width: w, height: h, photo } = debug;
  const seen = new Uint8Array(w * h);
  let total = 0, largest = 0, pieces = 0;
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (photo[i] <= -2 || seen[i]) continue;
    pieces++;
    let size = 0;
    seen[i] = 1; stack.push(i);
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % w, y = (p - x) / w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && !seen[q] && photo[q] > -2) { seen[q] = 1; stack.push(q); }
      }
    }
    total += size;
    largest = Math.max(largest, size);
  }
  if (!total) return ['The photo came out with no silhouette at all: the background segmentation found no person. Pass a mask (white = the person).'];
  if (largest / total >= FIT_MIN_MAIN_SHARE) return [];
  return [`The photo's silhouette came out in ${pieces} pieces (the largest is ${Math.round((largest / total) * 100)}% of it): the background segmentation probably lost part of the person against the background, and the fit will match the wrong outline. Pass a mask (white = the person), and crop to the person if others are in the photo.`];
}

/** A best fit below this silhouette IoU means no body matched the photo's
 *  outline (fits on clean photos land around 0.8–0.9). */
const FIT_LOW_SCORE = 0.6;

/** A warning when the best fit still matches the photo's outline poorly. */
export function fitScoreWarnings(score: number): string[] {
  if (score >= FIT_LOW_SCORE) return [];
  return [`The best fit matches only ${Math.round(score * 100)}% of the photo's outline, so the outline is probably not the person: a busy background the segmentation got wrong, other people in the frame, or the person cut off. Pass a mask (white = the person) and crop to them; check the outline with model:preview --match-photo … --match-overlay.`];
}
