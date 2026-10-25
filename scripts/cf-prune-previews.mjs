#!/usr/bin/env node
// Delete Cloudflare Pages *preview* deployments (the per-branch
// <branch>.<project>.pages.dev environments every pushed branch gets).
// Covers every Pages project in the account unless --project narrows it.
//
// Production deployments are never touched: the script only lists
// `env=preview` and re-checks `environment` on every row before deleting.
// By default the pipeline branches `main` and `staging` (also preview envs —
// see CLAUDE.md → Deployment) are kept; pass `--keep ''` to prune them too.
//
// Dry run by default — prints what it would delete. Add --yes to delete.
//
//   CLOUDFLARE_API_TOKEN=…  CLOUDFLARE_ACCOUNT_ID=…  npm run cf:prune-previews
//   npm run cf:prune-previews -- --yes                       # delete for real
//   npm run cf:prune-previews -- --branch 'claude/*' --yes   # only matching branches
//   npm run cf:prune-previews -- --older-than 14 --yes       # only deployments > 14 days old
//   npm run cf:prune-previews -- --keep main,staging,demo    # extra branches to keep
//   npm run cf:prune-previews -- --project partwright        # one project only
//
// The token needs the "Cloudflare Pages: Edit" account permission. Deleting
// every deployment of a branch also retires its <branch>.<project>.pages.dev
// alias. Stopping new previews from being created is a project setting
// (Pages → Settings → Builds → Branch control), not something this script does.

const API = 'https://api.cloudflare.com/client/v4';

function usage(msg) {
  if (msg) console.error(`error: ${msg}\n`);
  console.error(`usage: node scripts/cf-prune-previews.mjs [options]

  --yes               actually delete (default: dry run)
  --project <name>    only this Pages project, repeatable (default: $CF_PAGES_PROJECT,
                      else every project in the account)
  --keep <a,b,…>      branches to leave alone (default: "main,staging"; '' keeps none)
  --branch <glob>     only prune branches matching this glob (* and ?), repeatable
  --older-than <days> only prune deployments created more than <days> ago
  --concurrency <n>   parallel DELETE requests (default: 4)

env: CLOUDFLARE_API_TOKEN (required), CLOUDFLARE_ACCOUNT_ID (required)`);
  process.exit(msg ? 1 : 0);
}

function parseArgs(argv) {
  const opts = {
    yes: false,
    projects: process.env.CF_PAGES_PROJECT ? [process.env.CF_PAGES_PROJECT] : [],
    keep: ['main', 'staging'],
    branchGlobs: [],
    olderThanDays: null,
    concurrency: 4,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) usage(`${arg} needs a value`);
      return argv[++i];
    };
    switch (arg) {
      case '--yes': case '-y': opts.yes = true; break;
      case '--project': opts.projects.push(next()); break;
      case '--keep': opts.keep = next().split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--branch': opts.branchGlobs.push(next()); break;
      case '--older-than': {
        const n = Number(next());
        if (!Number.isFinite(n) || n < 0) usage('--older-than must be a non-negative number of days');
        opts.olderThanDays = n;
        break;
      }
      case '--concurrency': {
        const n = Number(next());
        if (!Number.isInteger(n) || n < 1) usage('--concurrency must be a positive integer');
        opts.concurrency = n;
        break;
      }
      case '--help': case '-h': usage(); break;
      default: usage(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

const opts = parseArgs(process.argv.slice(2));
const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token) usage('CLOUDFLARE_API_TOKEN is not set');
if (!accountId) usage('CLOUDFLARE_ACCOUNT_ID is not set');

const accountBase = `${API}/accounts/${encodeURIComponent(accountId)}/pages/projects`;

async function cf(url, init = {}, attempt = 0) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
  // Back off on rate limiting / transient server errors (API limit is 1200 req / 5 min).
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    const wait = Number(res.headers.get('retry-after')) * 1000 || 2 ** attempt * 1000;
    await new Promise((r) => setTimeout(r, wait));
    return cf(url, init, attempt + 1);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    const errs = body?.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') || res.statusText;
    throw new Error(`${init.method ?? 'GET'} ${url} → ${res.status} ${errs}`);
  }
  return body;
}

// Page sizes differ per endpoint: the projects list rejects per_page > 10
// (error 8000024), while deployments accepts 25.
async function listAll(url, perPage) {
  const all = [];
  const sep = url.includes('?') ? '&' : '?';
  for (let page = 1; ; page++) {
    const body = await cf(`${url}${sep}page=${page}&per_page=${perPage}`);
    all.push(...body.result);
    const info = body.result_info ?? {};
    const totalPages = info.total_pages ?? Math.ceil((info.total_count ?? 0) / (info.per_page || perPage));
    if (!body.result.length || page >= totalPages) break;
  }
  return all;
}

const deploymentsUrl = (project) => `${accountBase}/${encodeURIComponent(project)}/deployments`;
const branchOf = (d) => d.deployment_trigger?.metadata?.branch ?? '(unknown)';

const projects = opts.projects.length ? opts.projects : (await listAll(accountBase, 10)).map((p) => p.name);
if (!projects.length) {
  console.log('no Pages projects in this account.');
  process.exit(0);
}

const branchRes = opts.branchGlobs.map(globToRegExp);
const cutoff = opts.olderThanDays == null ? null : Date.now() - opts.olderThanDays * 86_400_000;
const isTarget = (d) => {
  if (d.environment !== 'preview') return false; // belt and braces: never production
  const branch = branchOf(d);
  if (opts.keep.includes(branch)) return false;
  if (branchRes.length && !branchRes.some((re) => re.test(branch))) return false;
  if (cutoff != null && Date.parse(d.created_on) > cutoff) return false;
  return true;
};

const targets = [];
if (opts.keep.length) console.log(`keeping branches: ${opts.keep.join(', ')}`);
for (const project of projects) {
  const deployments = await listAll(`${deploymentsUrl(project)}?env=preview`, 25);
  const selected = deployments.filter(isTarget);
  const byBranch = new Map();
  for (const d of selected) byBranch.set(branchOf(d), (byBranch.get(branchOf(d)) ?? 0) + 1);
  console.log(`\nproject ${project}: ${deployments.length} preview deployment(s); ` +
    `${selected.length} selected across ${byBranch.size} branch(es)`);
  for (const [branch, n] of [...byBranch].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    console.log(`  ${String(n).padStart(4)}  ${branch}`);
  }
  targets.push(...selected.map((d) => ({ project, d })));
}

if (!targets.length) process.exit(0);
if (!opts.yes) {
  console.log(`\ndry run — re-run with --yes to delete these ${targets.length} deployment(s).`);
  process.exit(0);
}

// Delete oldest first so a branch's alias (its newest deployment) goes last.
targets.sort((a, b) => Date.parse(a.d.created_on) - Date.parse(b.d.created_on));
let done = 0;
const failures = [];
let next = 0;
async function worker() {
  while (next < targets.length) {
    const t = targets[next++];
    try {
      // force=true is required to delete a deployment that a branch alias points at.
      await cf(`${deploymentsUrl(t.project)}/${encodeURIComponent(t.d.id)}?force=true`, { method: 'DELETE' });
    } catch (err) {
      failures.push({ ...t, err });
    }
    done++;
    if (done % 25 === 0 || done === targets.length) {
      process.stdout.write(`${process.stdout.isTTY ? '\r' : '\n'}deleted ${done - failures.length}/${targets.length}` +
        (failures.length ? ` (${failures.length} failed)` : ''));
    }
  }
}
await Promise.all(Array.from({ length: Math.min(opts.concurrency, targets.length) }, worker));
process.stdout.write('\n');

for (const { project, d, err } of failures) console.error(`  failed ${project}/${d.id} (${branchOf(d)}): ${err.message}`);
process.exit(failures.length ? 1 : 0);
