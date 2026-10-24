#!/usr/bin/env node
// Attach screenshots to the current branch's PR as a "Visual proof" comment,
// without committing them to the PR branch.
//
//   npm run pr:screenshots -- test-results/before.png test-results/after.png
//   npm run pr:screenshots -- --layout proof.md before.png after.png
//   npm run pr:screenshots -- --refresh            # re-post the last upload
//
// 1. Pushes the images to the shared, never-merged `pr-assets` branch as one
//    upload batch (`<branch-folder>/<UTC stamp>/<image>`), using git plumbing
//    with a temporary index: your working tree, index and HEAD are untouched.
// 2. The `Visual proof comment` workflow (.github/workflows/pr-visual-proof.yml)
//    posts the newest upload as ONE PR comment and checks GitHub renders every
//    image. It runs on the PR's next open/push, and this script dispatches it
//    right away when `gh` is allowed to (locally; cloud sessions can't, so it
//    prints the GitHub MCP call to make instead). The comment must come from
//    the workflow: cloud sessions' GitHub proxy defangs image links that a
//    session posts itself.
//
// --layout <file.md>  Markdown for the comment, e.g. a before/after table.
//                     Reference images by file name (`![after](after.png)`);
//                     links are pinned to the upload. Default: two per row.
// --pr <n>            Target PR (default: the open PR whose head is this branch).
// --branch <name>     Act for another branch: its pr-assets folder and open PR
//                     (default: the checked-out branch).
// --refresh           Skip the upload; just ask the workflow to post again.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { folderForBranch, groupBatches, resolveProofMarkdown, safeFileName } from './lib/visualProof.mjs';

const WORKFLOW = 'pr-visual-proof.yml';
const ASSETS_BRANCH = 'pr-assets';
const ASSETS_REF = `refs/remotes/origin/${ASSETS_BRANCH}`;
const IMAGE_RE = /\.(png|jpe?g|gif|webp)$/i;

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trim();
}

/** `gh api` REST call; `body` is sent as JSON on stdin. */
function gh(path, { method = 'GET', body } = {}) {
  const out = execFileSync('gh', ['api', path, '-X', method, ...(body ? ['--input', '-'] : [])], {
    encoding: 'utf8',
    input: body ? JSON.stringify(body) : undefined,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return out.trim() ? JSON.parse(out) : null;
}

function parseArgs(argv) {
  const opts = { images: [], layout: null, pr: null, branch: null, refresh: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i];
      if (!v) fail(`${a.split('=')[0]} needs a value`);
      return v;
    };
    if (a === '--layout' || a.startsWith('--layout=')) opts.layout = value();
    else if (a === '--pr' || a.startsWith('--pr=')) opts.pr = Number(value());
    else if (a === '--branch' || a.startsWith('--branch=')) opts.branch = value();
    else if (a === '--refresh') opts.refresh = true;
    else if (a === '-h' || a === '--help') {
      console.log('usage: npm run pr:screenshots -- [--layout proof.md] [--pr N] [--branch B] <image>...\n       npm run pr:screenshots -- --refresh [--pr N] [--branch B]');
      process.exit(0);
    } else if (a.startsWith('--')) fail(`unknown option ${a}`);
    else opts.images.push(a);
  }
  if (opts.pr !== null && !(Number.isInteger(opts.pr) && opts.pr > 0)) fail('--pr needs a PR number');
  if (!opts.refresh && opts.images.length === 0) fail('no images given (or pass --refresh)');
  if (opts.refresh && (opts.images.length > 0 || opts.layout)) fail('--refresh takes no images or --layout');
  const names = new Set();
  for (const f of [...opts.images, ...(opts.layout ? [opts.layout] : [])]) {
    let isFile = false;
    try {
      isFile = statSync(f).isFile();
    } catch {
      // missing: reported below
    }
    if (!isFile) fail(`no such file: ${f}`);
  }
  for (const f of opts.images) {
    const name = basename(f);
    if (!IMAGE_RE.test(name)) fail(`not an image (png/jpg/gif/webp): ${f}`);
    if (names.has(safeFileName(name))) fail(`two images would be stored as ${safeFileName(name)}; rename one`);
    names.add(safeFileName(name));
  }
  return opts;
}

function stderrOf(e) {
  return String(e.stderr || e.message).trim();
}

/** Fetch pr-assets; returns its tip SHA, or null if the branch doesn't exist yet. */
function fetchAssets() {
  try {
    git(['fetch', '-q', 'origin', `+refs/heads/${ASSETS_BRANCH}:${ASSETS_REF}`]);
  } catch (e) {
    if (/couldn't find remote ref/i.test(stderrOf(e))) return null;
    throw new Error(`fetching ${ASSETS_BRANCH} failed: ${stderrOf(e)}`);
  }
  return git(['rev-parse', ASSETS_REF]);
}

/** Push one upload batch to pr-assets; returns the new commit SHA. */
function upload(images, layout, batch, branch) {
  const tmp = mkdtempSync(join(tmpdir(), 'pr-assets-'));
  const env = { ...process.env, GIT_INDEX_FILE: join(tmp, 'index') };
  try {
    for (let attempt = 1; attempt <= 4; attempt++) {
      const parent = fetchAssets();
      if (parent) {
        git(['read-tree', parent], { env });
      } else {
        // First use: start the orphan branch with a README explaining it.
        git(['read-tree', '--empty'], { env });
        const readme = git(['hash-object', '-w', '--stdin'], {
          input: [
            '# pr-assets',
            '',
            'Screenshots for PR "Visual proof" comments, uploaded by `npm run pr:screenshots`.',
            'One folder per PR branch, one sub-folder per upload. **Never merge, rebase or',
            "delete this branch**: PR comments link to its commits, and it keeps screenshots out of main's history.",
            '',
          ].join('\n'),
        });
        git(['update-index', '--add', '--cacheinfo', `100644,${readme},README.md`], { env });
      }
      for (const f of images) {
        const blob = git(['hash-object', '-w', f]);
        git(['update-index', '--add', '--cacheinfo', `100644,${blob},${batch}/${safeFileName(basename(f))}`], { env });
      }
      if (layout) {
        // Point the layout's references at the stored (URL-safe) names.
        const renames = { images: images.map((f) => ({ name: basename(f), path: safeFileName(basename(f)) })) };
        const text = resolveProofMarkdown(readFileSync(layout, 'utf8'), renames, (p) => p);
        const blob = git(['hash-object', '-w', '--stdin'], { input: text });
        git(['update-index', '--add', '--cacheinfo', `100644,${blob},${batch}/proof.md`], { env });
      }
      const tree = git(['write-tree'], { env });
      const commit = git(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', `screenshots for ${branch}`]);
      try {
        // --no-verify: the repo's pre-push hooks are for code pushes, not screenshots.
        git(['push', '-q', '--no-verify', 'origin', `${commit}:refs/heads/${ASSETS_BRANCH}`]);
      } catch (e) {
        // Only a concurrent upload (non-fast-forward) is worth retrying.
        const raced = /non-fast-forward|fetch first|stale info|cannot lock ref/i.test(stderrOf(e));
        if (!raced || attempt === 4) throw new Error(`push to ${ASSETS_BRANCH} failed: ${stderrOf(e)}`);
        console.error(`${ASSETS_BRANCH} moved during the upload (attempt ${attempt}); refetching and retrying…`);
        execFileSync('sleep', [String(attempt * 2)]);
        continue;
      }
      git(['update-ref', ASSETS_REF, commit]);
      return commit;
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function findPr(slug, branch) {
  const owner = slug.split('/')[0];
  const prs = gh(`repos/${slug}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`);
  return prs.length > 0 ? prs[0].number : null;
}

/** Sanity check: the upload is exactly what the workflow will show. */
function checkUpload(assetsSha, folder, uploaded) {
  // -z: unquoted paths, so non-ASCII file names survive.
  const paths = git(['ls-tree', '-r', '-z', '--full-tree', '--name-only', assetsSha, '--', `${folder}/`]).split('\0').filter(Boolean);
  const latest = groupBatches(paths, folder).at(-1);
  const shown = new Set((latest?.images ?? []).map((img) => img.path));
  const lost = uploaded.filter((path) => !shown.has(path));
  if (latest?.stamp !== uploaded[0].split('/')[1] || lost.length > 0) {
    throw new Error(`the comment would leave out ${lost.join(', ') || 'this upload'}; please report this as a pr:screenshots bug`);
  }
}

/** Ask the workflow to post now; returns false where gh may not dispatch. */
function dispatch(slug, pr, stamp) {
  const inputs = { pr: String(pr), ...(stamp ? { upload: stamp } : {}) };
  try {
    gh(`repos/${slug}/actions/workflows/${WORKFLOW}/dispatches`, { method: 'POST', body: { ref: 'main', inputs } });
    console.log(`Started the Visual proof workflow for PR #${pr}; the comment appears in about a minute (a red check means an image didn't render).`);
    return true;
  } catch (e) {
    console.log(`Couldn't start the workflow from here (${stderrOf(e).split('\n')[0]}).`);
    console.log("It runs on the PR's next push. To post now, use the GitHub MCP tool:");
    console.log(`  actions_run_trigger method=run_workflow owner=${slug.split('/')[0]} repo=${slug.split('/')[1]} workflow_id=${WORKFLOW} ref=main inputs=${JSON.stringify(inputs)}`);
    return false;
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const branch = opts.branch ?? git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch === 'HEAD') fail('detached HEAD; check out the PR branch first (or pass --branch)');
  const slug = git(['remote', 'get-url', 'origin']).replace(/\.git$/, '').replace(/^.*[:/]([^/]+\/[^/]+)$/, '$1');
  const folder = folderForBranch(branch);

  let stamp = null;
  if (opts.refresh) {
    if (!fetchAssets()) fail(`no ${ASSETS_BRANCH} branch yet; upload some screenshots first`);
  } else {
    stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const batch = `${folder}/${stamp}`;
    const assetsSha = upload(opts.images, opts.layout, batch, branch);
    checkUpload(assetsSha, folder, opts.images.map((f) => `${batch}/${safeFileName(basename(f))}`));
    console.log(`Uploaded ${opts.images.length} image(s) to ${ASSETS_BRANCH}/${batch} (${assetsSha.slice(0, 7)}).`);
  }

  const pr = opts.pr ?? findPr(slug, branch);
  if (!pr) {
    console.log(`No open PR for ${branch} yet; the Visual proof workflow posts the screenshots when it's opened.`);
    return;
  }
  dispatch(slug, pr, stamp);
}

try {
  main();
} catch (e) {
  fail(e.message);
}
