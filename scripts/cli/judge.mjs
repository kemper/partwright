// judge.mjs — pluggable quality judges for the figure eval loop.
//
// A judge takes a rendered CANDIDATE (matched-angle tiles) + a REFERENCE
// (the target the figure should look like) + a rubric, and returns:
//   { score: 0..100, perItem: [{ item, pass, severity, critique, fix }],
//     usage: { provider, model, inputTokens, outputTokens, estUsd } }
//
// Four adapters, deliberately tiered by cost:
//   - 'claude' — DEFAULT semantic judge. Shells to the `claude` CLI in headless
//                print mode (`-p --output-format json`), which is present in the
//                Claude Code container and bills against the user's Max OAuth —
//                so it RUNS AND IS TESTABLE IN-CONTAINER. Returns a part-level
//                checklist + per-item geometry fixes.
//   - 'pixel'  — FREE, offline. Structural similarity of candidate vs reference
//                tiles. NOT an anatomy judge; a cheap regression sentinel that
//                proves the loop and catches silhouette changes. Always runnable.
//   - 'human'  — FREE. Emits the contact sheet + rubric and reads a verdict the
//                human fills in. The anchor that keeps the cheap judges honest.
//   - 'gemini' — CHEAP cloud vision on a quota SEPARATE from Max. Shells to the
//                `gemini` CLI, which lives on the user's machine (not the
//                container). An alternate semantic judge.
//
// Every adapter reports `usage` so the harness can tally spend and enforce a
// per-run budget — the whole point being that you SEE the cost of looping.

import sharp from 'sharp';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

// --- pixel judge: free offline structural-similarity sentinel ---------------

// Mean per-pixel similarity (0..100) between two equal-size PNG buffers.
// Crude but real and deterministic: it moves when the geometry's silhouette/
// shading moves, so it proves "score tracks model changes" with no API key.
async function pixelSimilarity(candidatePng, referencePng) {
  const norm = (buf) => sharp(buf).resize(384, 384, { fit: 'fill' }).greyscale().raw().toBuffer();
  const [a, b] = await Promise.all([norm(candidatePng), norm(referencePng)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
  const meanAbs = diff / a.length;          // 0 (identical) .. 255 (inverted)
  return Math.max(0, Math.round((1 - meanAbs / 255) * 100));
}

async function pixelJudge({ candidatePng, referencePng }) {
  if (!referencePng) {
    throw new Error('pixel judge needs a reference image — generate one with `eval:figures --set-reference` first');
  }
  const score = await pixelSimilarity(candidatePng, referencePng);
  return {
    score,
    perItem: [{
      item: 'silhouette/shading similarity to reference',
      pass: score >= 90,
      severity: score >= 90 ? 'none' : score >= 75 ? 'minor' : 'major',
      critique: `pixel similarity ${score}/100 vs reference tiles`,
      fix: score >= 90 ? '' : 'inspect the contact sheet; structural drift from the reference',
    }],
    usage: { provider: 'pixel', model: 'offline-ssim', inputTokens: 0, outputTokens: 0, estUsd: 0 },
  };
}

// --- human judge: the offline anchor ----------------------------------------

// Writes a verdict template next to the contact sheet and reads it back if the
// human has filled it. Returns null (pending) when no verdict yet, so the
// harness can print "awaiting human verdict" instead of inventing a score.
function humanJudge({ verdictPath, rubric }) {
  if (!existsSync(verdictPath)) {
    const tmpl = {
      score: null,
      note: 'Fill score (0-100) and per-item pass/critique/fix, then re-run the same command to record it.',
      perItem: rubric.items.map((item) => ({ item, pass: null, severity: '', critique: '', fix: '' })),
    };
    writeFileSync(verdictPath, JSON.stringify(tmpl, null, 2));
    return null; // pending
  }
  const v = JSON.parse(readFileSync(verdictPath, 'utf8'));
  if (v.score == null) return null; // template not yet filled
  return {
    score: Number(v.score),
    perItem: v.perItem || [],
    usage: { provider: 'human', model: 'eyes', inputTokens: 0, outputTokens: 0, estUsd: 0 },
  };
}

// --- claude judge: the default semantic judge (runs IN the container) --------

// Shells to the `claude` CLI in headless print mode. Run from a tmp cwd (not
// the repo) so the project's own hooks/settings don't intercept the output, and
// attach the contact sheet via the `@<abs-path>` mention (inlined into context,
// no Read-tool permission needed). The JSON envelope's `.result` is the model's
// reply (our strict judge JSON); `.total_cost_usd` + `.usage` drive the spend
// tally. Bills against the user's Max OAuth, so it's free-at-the-margin to loop.
function claudeJudge({ contactSheetPath, rubric, model = process.env.EVAL_JUDGE_MODEL || 'claude-sonnet-4-6', claudePath }) {
  const bin = claudePath || process.env.CLAUDE_PATH || 'claude';
  const prompt = buildJudgePrompt(rubric);
  let out;
  try {
    out = execFileSync(bin, ['-p', `${prompt}\n\n@${contactSheetPath}`, '--output-format', 'json', '--model', model], {
      encoding: 'utf8', cwd: tmpdir(), maxBuffer: 16 * 1024 * 1024, timeout: 180000,
    });
  } catch (e) {
    throw new Error(`claude CLI failed (is "${bin}" on PATH and authed?): ${e.message}`);
  }
  let env;
  try { env = JSON.parse(out); } catch { throw new Error(`claude CLI did not return JSON envelope: ${out.slice(0, 300)}`); }
  if (env.is_error) throw new Error(`claude judge error: ${env.result || env.subtype}`);
  const json = extractJson(env.result);
  return {
    score: Number(json.score),
    perItem: json.perItem || [],
    usage: {
      provider: 'claude', model,
      inputTokens: env.usage?.input_tokens ?? 0,
      outputTokens: env.usage?.output_tokens ?? 0,
      estUsd: env.total_cost_usd ?? 0,
    },
  };
}

// --- gemini judge: alternate semantic judge (runs on the user's machine) ------

// Gemini Flash pricing (approx, per 1M tokens) for the spend estimate. Tunable
// via env so the printed cost stays honest as prices change.
const GEMINI_IN_USD_PER_MTOK = Number(process.env.GEMINI_IN_USD_PER_MTOK || 0.10);
const GEMINI_OUT_USD_PER_MTOK = Number(process.env.GEMINI_OUT_USD_PER_MTOK || 0.40);

function geminiJudge({ contactSheetPath, rubric, model = process.env.GEMINI_MODEL || 'gemini-2.0-flash', geminiPath }) {
  const bin = geminiPath || process.env.GEMINI_PATH || 'gemini';
  const prompt = buildJudgePrompt(rubric);
  // Attach the contact-sheet image via the Gemini CLI's `@<path>` file-injection
  // syntax (not prose) so it's actually loaded into the vision context; ask for
  // STRICT JSON back. Args are passed as an array → no shell, no injection.
  let out;
  try {
    out = execFileSync(bin, ['-m', model, '-p', `${prompt}\n\n@${contactSheetPath}`], {
      encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    });
  } catch (e) {
    throw new Error(`gemini CLI failed (is it installed at "${bin}" with a key set?): ${e.message}`);
  }
  const json = extractJson(out);
  const inTok = json.usage?.inputTokens ?? estTokens(prompt) + 1300; // image ≈ ~1300 tok
  const outTok = json.usage?.outputTokens ?? estTokens(JSON.stringify(json));
  return {
    score: Number(json.score),
    perItem: json.perItem || [],
    usage: {
      provider: 'gemini', model,
      inputTokens: inTok, outputTokens: outTok,
      estUsd: (inTok / 1e6) * GEMINI_IN_USD_PER_MTOK + (outTok / 1e6) * GEMINI_OUT_USD_PER_MTOK,
    },
  };
}

// The judge prompt: demand a PART-LEVEL CHECKLIST with a suggested geometry
// fix per item — not a scalar. This is what made the manual photo-handoff work.
export function buildJudgePrompt(rubric) {
  return [
    'You are a 3D-figure anatomy reviewer. The image is a contact sheet:',
    'the LEFT column is a REFERENCE (the target look); the RIGHT column is a',
    'CANDIDATE 3D model render, at matched camera angles (rows).',
    'For EACH rubric item below, judge whether the candidate matches the',
    'reference, and if not, give the specific GEOMETRY change that would fix it',
    '(which body part, which direction, roughly how much).',
    '',
    'Rubric items:',
    ...rubric.items.map((it, i) => `  ${i + 1}. ${it}`),
    '',
    'Respond with STRICT JSON only, no prose:',
    '{ "score": <0-100 overall>, "perItem": [',
    '  { "item": "<rubric item>", "pass": <bool>, "severity": "none|minor|major",',
    '    "critique": "<what differs from the reference>",',
    '    "fix": "<specific geometry change, or empty if pass>" } ] }',
  ].join('\n');
}

function estTokens(s) { return Math.ceil((s || '').length / 4); }

function extractJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`judge did not return JSON. Got: ${text.slice(0, 300)}`);
  return JSON.parse(m[0]);
}

// --- dispatch ---------------------------------------------------------------

export async function runJudge(kind, ctx) {
  switch (kind) {
    case 'claude': return claudeJudge(ctx);
    case 'pixel': return pixelJudge(ctx);
    case 'human': return humanJudge(ctx);
    case 'gemini': return geminiJudge(ctx);
    default: throw new Error(`unknown judge "${kind}" (use claude|pixel|human|gemini)`);
  }
}
