#!/usr/bin/env node
// Refresh src/ai/generated/modelsCatalog.json from models.dev.
//
// Primary path: fetch https://models.dev/api.json (one request, fully built
// JSON). Fallback path: enumerate provider TOMLs via the GitHub tree API and
// parse them inline — used when models.dev is unreachable (sandboxed CI,
// restrictive corporate proxy) so the bootstrap and refresh still works.
//
// Wired into Vite via the catalogSnapshot plugin in vite.config.ts:
// `buildStart` runs this so every build/dev start tries to refresh. On any
// failure (network down, schema drift, parse error) the committed snapshot is
// preserved and the build proceeds, so the catalog can never break the build.
//
// Filter: only providers we wire up (anthropic / openai / google) and only
// models whose release_date is within the last MAX_AGE_DAYS days. Filtering
// at snapshot time keeps the bundle small and decouples the runtime from
// any unrelated provider's metadata changes.

import { writeFile, readFile, readdir, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const OUT_PATH = resolve(REPO_ROOT, 'src/ai/generated/modelsCatalog.json');

const PROVIDERS = ['anthropic', 'openai', 'google'];
const MAX_AGE_DAYS = 365;
const API_URL = 'https://models.dev/api.json';
const GITHUB_TREE_URL = 'https://api.github.com/repos/anomalyco/models.dev/git/trees/dev?recursive=1';
const RAW_BASE = 'https://raw.githubusercontent.com/anomalyco/models.dev/dev';

async function main() {
  const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 86_400_000);
  console.log(`[catalog] filtering to release_date >= ${cutoff.toISOString().slice(0, 10)} (last ${MAX_AGE_DAYS} days)`);

  const localFlag = process.argv.indexOf('--from-local');
  const localDir = localFlag !== -1 ? process.argv[localFlag + 1] : null;

  let raw;
  if (localDir) {
    try {
      raw = await fetchFromLocalDir(localDir);
      console.log(`[catalog] source: ${localDir} (local --from-local)`);
    } catch (e) {
      console.error(`[catalog] --from-local ${localDir} failed: ${e.message}`);
      process.exit(1);
    }
  } else {
    try {
      raw = await fetchFromApiJson();
      console.log(`[catalog] source: ${API_URL}`);
    } catch (apiErr) {
      console.warn(`[catalog] models.dev/api.json unreachable (${apiErr.message}); falling back to GitHub raw TOMLs`);
      try {
        raw = await fetchFromGithub();
        console.log(`[catalog] source: github.com/anomalyco/models.dev (dev branch)`);
      } catch (ghErr) {
        console.error(`[catalog] both refresh paths failed:\n  api.json: ${apiErr.message}\n  github:  ${ghErr.message}`);
        console.warn(`[catalog] keeping existing snapshot at ${OUT_PATH}`);
        // Soft-fail so the build can proceed with the committed snapshot.
        process.exit(0);
      }
    }
  }

  const filtered = filterCatalog(raw, cutoff);
  await mkdir(dirname(OUT_PATH), { recursive: true });
  const json = JSON.stringify(filtered, null, 2) + '\n';

  // Compare to the existing snapshot — if identical, skip the write so file
  // mtimes (and git status) stay clean across no-op refreshes.
  let prev = '';
  try { prev = await readFile(OUT_PATH, 'utf8'); } catch { /* first run */ }
  if (prev === json) {
    console.log(`[catalog] snapshot unchanged (${countModels(filtered)} models across ${Object.keys(filtered).length} providers)`);
    return;
  }
  // On Cloudflare Pages the working tree is ephemeral — writing here just
  // produces a "dirty" git status the developer never sees. Skip the write
  // (the committed snapshot ships in the bundle either way) so the deploy
  // log is quieter.
  if (process.env.CF_PAGES) {
    console.log(`[catalog] would have updated ${OUT_PATH} but CF_PAGES is set — skipping write (ephemeral build env)`);
    return;
  }
  await writeFile(OUT_PATH, json, 'utf8');
  console.log(`[catalog] wrote ${OUT_PATH} (${countModels(filtered)} models across ${Object.keys(filtered).length} providers)`);
}

function countModels(catalog) {
  let n = 0;
  for (const p of Object.values(catalog)) n += Object.keys(p.models ?? {}).length;
  return n;
}

function filterCatalog(raw, cutoff) {
  const out = {};
  let skippedShape = 0;
  for (const providerId of PROVIDERS) {
    const prov = raw[providerId];
    if (!prov) continue;
    const models = {};
    for (const [modelId, model] of Object.entries(prov.models ?? {})) {
      if (!looksLikeValidModel(model)) { skippedShape++; continue; }
      if (!isChatToolModel(model)) continue;
      if (!withinWindow(model.release_date, cutoff)) continue;
      models[modelId] = stripUnusedFields(model);
    }
    if (Object.keys(models).length === 0) continue;
    out[providerId] = {
      id: prov.id ?? providerId,
      name: prov.name ?? providerId,
      doc: prov.doc,
      env: prov.env,
      npm: prov.npm,
      models,
    };
  }
  if (skippedShape > 0) {
    console.warn(`[catalog] skipped ${skippedShape} entr(ies) failing required-field shape check`);
  }
  return out;
}

// Drop entries that obviously aren't chat-with-tools models the agent could
// actually drive: image generators, embedding models, the `*-chat-latest`
// non-tool variants OpenAI ships for the ChatGPT consumer flow, and anything
// the upstream catalog has marked deprecated.
function isChatToolModel(m) {
  if (!m || typeof m !== 'object') return false;
  if (m.tool_call !== true) return false;
  if (m.status === 'deprecated') return false;
  if (!m.cost || typeof m.cost.input !== 'number') return false;
  if (!m.limit || !(m.limit.context > 0)) return false;
  // text-out only — the agent doesn't consume audio/image outputs.
  const outMods = m.modalities?.output;
  if (Array.isArray(outMods) && !outMods.includes('text')) return false;
  return true;
}

// Drop upstream fields catalog.ts doesn't consume — keeps the bundled JSON
// lean. `experimental.modes.*` is the biggest offender (alternative pricing
// for opt-in fast/priority/flex tiers we don't route to).
function stripUnusedFields(m) {
  if (m && typeof m === 'object' && 'experimental' in m) {
    const { experimental: _unused, ...rest } = m;
    return rest;
  }
  return m;
}

// Cheap structural sanity check — required fields per the upstream schema
// (packages/core/src/schema.ts). Catches a TOML-parser regression or an
// upstream schema drift loudly during the refresh rather than after the
// JSON has already been written.
function looksLikeValidModel(m) {
  return (
    m && typeof m === 'object' &&
    typeof m.name === 'string' && m.name.length > 0 &&
    typeof m.release_date === 'string' && /^\d{4}-\d{2}(-\d{2})?$/.test(m.release_date) &&
    typeof m.attachment === 'boolean' &&
    typeof m.reasoning === 'boolean' &&
    typeof m.tool_call === 'boolean' &&
    m.modalities && Array.isArray(m.modalities.input) && Array.isArray(m.modalities.output) &&
    m.limit && typeof m.limit.context === 'number' && typeof m.limit.output === 'number'
  );
}

function withinWindow(releaseDate, cutoff) {
  if (typeof releaseDate !== 'string') return false;
  // Schema allows YYYY-MM and YYYY-MM-DD; treat month-only as the 1st.
  const m = releaseDate.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +(m[3] ?? '01')));
  return d >= cutoff;
}

async function fetchFromApiJson() {
  const res = await fetchWithTimeout(API_URL, 15_000);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.text();
  let data;
  try { data = JSON.parse(body); } catch (e) { throw new Error(`invalid JSON: ${e.message}`); }
  if (!data || typeof data !== 'object') throw new Error('top-level not an object');
  // Sanity check: at least one provider we want should exist.
  if (!PROVIDERS.some((p) => p in data)) throw new Error('no expected providers present');
  return data;
}

async function fetchFromGithub() {
  const treeRes = await fetchWithTimeout(GITHUB_TREE_URL, 15_000, { 'User-Agent': 'partwright-refresh-models' });
  if (!treeRes.ok) throw new Error(`tree HTTP ${treeRes.status}`);
  const tree = await treeRes.json();
  if (tree.truncated) throw new Error('GitHub tree truncated — too many files');
  const paths = (tree.tree ?? [])
    .filter((t) => t.type === 'blob')
    .map((t) => t.path)
    .filter((p) => p.endsWith('.toml') && PROVIDERS.some((prov) => p.startsWith(`providers/${prov}/`)));

  const providerMetaPaths = paths.filter((p) => /^providers\/[^/]+\/provider\.toml$/.test(p));
  const modelPaths = paths.filter((p) => /^providers\/[^/]+\/models\//.test(p));

  // Fan out fetches in batches of 12 to stay under GitHub's per-IP burst.
  const fetched = new Map();
  const all = [...providerMetaPaths, ...modelPaths];
  for (let i = 0; i < all.length; i += 12) {
    const batch = all.slice(i, i + 12);
    const results = await Promise.all(batch.map(async (p) => {
      const r = await fetchWithTimeout(`${RAW_BASE}/${p}`, 10_000);
      if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
      return [p, await r.text()];
    }));
    for (const [p, body] of results) fetched.set(p, body);
  }

  const out = {};
  for (const providerId of PROVIDERS) {
    const metaPath = `providers/${providerId}/provider.toml`;
    const provider = { id: providerId, models: {} };
    if (fetched.has(metaPath)) {
      const meta = parseToml(fetched.get(metaPath));
      Object.assign(provider, meta);
      provider.id = providerId; // path wins over any in-file id
    }
    for (const p of modelPaths) {
      if (!p.startsWith(`providers/${providerId}/models/`)) continue;
      const modelId = p
        .replace(`providers/${providerId}/models/`, '')
        .replace(/\.toml$/, '');
      const body = fetched.get(p);
      if (!body) continue;
      try {
        const model = parseToml(body);
        model.id = modelId;
        provider.models[modelId] = model;
      } catch (e) {
        console.warn(`[catalog] skipping ${p}: ${e.message}`);
      }
    }
    out[providerId] = provider;
  }
  return out;
}

async function fetchFromLocalDir(dir) {
  // Layout expected: <dir>/providers/<provider>/{provider.toml, models/*.toml}
  const providersDir = join(dir, 'providers');
  try { await stat(providersDir); } catch { throw new Error(`no providers/ subdir under ${dir}`); }
  const out = {};
  for (const providerId of PROVIDERS) {
    const provDir = join(providersDir, providerId);
    let entries;
    try { entries = await readdir(provDir, { withFileTypes: true }); }
    catch { continue; }
    const provider = { id: providerId, models: {} };
    for (const ent of entries) {
      if (ent.isFile() && ent.name === 'provider.toml') {
        const body = await readFile(join(provDir, ent.name), 'utf8');
        Object.assign(provider, parseToml(body));
        provider.id = providerId;
      }
    }
    const modelsDir = join(provDir, 'models');
    let modelEntries;
    try { modelEntries = await readdir(modelsDir, { withFileTypes: true }); }
    catch { modelEntries = []; }
    for (const ent of modelEntries) {
      if (!ent.isFile() || !ent.name.endsWith('.toml')) continue;
      const modelId = ent.name.replace(/\.toml$/, '');
      const body = await readFile(join(modelsDir, ent.name), 'utf8');
      try {
        const model = parseToml(body);
        model.id = modelId;
        provider.models[modelId] = model;
      } catch (e) {
        console.warn(`[catalog] skipping ${providerId}/${ent.name}: ${e.message}`);
      }
    }
    out[providerId] = provider;
  }
  return out;
}

async function fetchWithTimeout(url, ms, headers = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { headers, signal: ctrl.signal, redirect: 'follow' });
  } finally {
    clearTimeout(t);
  }
}

// Minimal TOML parser for the subset models.dev uses:
//   - top-level `key = value`
//   - `[section]` (one level deep: cost / limit / modalities / provider)
//   - `[[section.array]]` array-of-tables (cost.tiers)
//   - `[section.subsection]` (provider.body, provider.headers — flattened)
//   - values: string ("..."), number (with optional `_` separators), bool, inline array
//   - line comments starting with `#` outside strings
function parseToml(text) {
  const out = {};
  let cur = out;        // current write target for top-level keys / section keys
  let curArr = null;    // when inside [[a.b]], the element we're filling
  const lines = text.split(/\r?\n/);
  for (let raw of lines) {
    const line = stripComment(raw).trim();
    if (line === '') continue;
    if (line.startsWith('[[')) {
      const close = line.indexOf(']]');
      if (close === -1) throw new Error(`unterminated array-of-tables header: ${line}`);
      const path = line.slice(2, close).trim().split('.');
      let parent = out;
      for (let i = 0; i < path.length - 1; i++) {
        parent[path[i]] = parent[path[i]] ?? {};
        parent = parent[path[i]];
      }
      const last = path[path.length - 1];
      parent[last] = parent[last] ?? [];
      curArr = {};
      parent[last].push(curArr);
      cur = curArr;
      continue;
    }
    if (line.startsWith('[')) {
      const close = line.indexOf(']');
      if (close === -1) throw new Error(`unterminated section header: ${line}`);
      const path = line.slice(1, close).trim().split('.');
      let parent = out;
      for (let i = 0; i < path.length - 1; i++) {
        parent[path[i]] = parent[path[i]] ?? {};
        parent = parent[path[i]];
      }
      const last = path[path.length - 1];
      parent[last] = parent[last] ?? {};
      cur = parent[last];
      curArr = null;
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const valStr = line.slice(eq + 1).trim();
    cur[key] = parseValue(valStr);
  }
  return out;
}

function stripComment(line) {
  // Strip `# ...` only outside double-quoted strings (our subset has no
  // single-quotes or escapes worth worrying about).
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inStr = !inStr;
    else if (!inStr && ch === '#') return line.slice(0, i);
  }
  return line;
}

function parseValue(s) {
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (inner === '') return [];
    // Inline-array of either strings or numbers.
    return splitInlineArray(inner).map(parseValue);
  }
  if (s.startsWith('{') && s.endsWith('}')) {
    // Inline table — rare here, but parse minimally.
    const inner = s.slice(1, -1).trim();
    const out = {};
    for (const part of splitInlineArray(inner)) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      out[part.slice(0, eq).trim()] = parseValue(part.slice(eq + 1).trim());
    }
    return out;
  }
  // Number: strip underscores, accept int or float.
  const num = s.replace(/_/g, '');
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(num)) return Number(num);
  return s;
}

function splitInlineArray(inner) {
  // Split on commas not inside quotes or nested brackets.
  const out = [];
  let depth = 0, inStr = false, start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '"') inStr = !inStr;
    else if (!inStr && (ch === '[' || ch === '{')) depth++;
    else if (!inStr && (ch === ']' || ch === '}')) depth--;
    else if (!inStr && depth === 0 && ch === ',') {
      out.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = inner.slice(start).trim();
  if (last) out.push(last);
  return out;
}

main().catch((e) => {
  console.error(`[catalog] unexpected error: ${e.stack || e.message}`);
  process.exit(0); // soft-fail — keep committed snapshot
});
