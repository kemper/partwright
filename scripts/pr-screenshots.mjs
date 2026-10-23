#!/usr/bin/env node
// Attach screenshots to the current branch's PR as a "Visual proof" comment,
// without committing them to the PR branch.
//
//   npm run pr:screenshots -- test-results/before.png test-results/after.png
//   npm run pr:screenshots -- --layout proof.md before.png after.png
//   npm run pr:screenshots -- --refresh            # re-post the last upload (e.g. after opening the PR)
//
// 1. Pushes the images to the shared, never-merged `pr-assets` branch as one
//    upload batch (`<branch-folder>/<UTC stamp>/<image>`), using git plumbing
//    with a temporary index: your working tree, index and HEAD are untouched.
// 2. Finds the open PR for the current branch (or --pr N) and creates or
//    updates ONE comment rendering the newest upload inline (earlier uploads
//    collapse to links), via `gh api` (REST).
// 3. Reads the rendered comment back and fails unless GitHub shows every
//    image, so a broken link can't go unnoticed.
//
// --layout <file.md>  Markdown for the comment, e.g. a before/after table.
//                     Reference images by file name (`![after](after.png)`);
//                     links are pinned to the upload. Default: two per row.
// --pr <n>            Target PR (default: the open PR whose head is this branch).
// --refresh           Skip the upload; re-render the comment from pr-assets.
//
// No open PR yet? The upload is kept; run `--refresh` once the PR exists.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  COMMENT_MARKER,
  folderForBranch,
  groupBatches,
  missingImages,
  renderComment,
  resolveProofMarkdown,
  safeFileName,
} from './lib/visualProof.mjs';

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

/** `gh api` call; `body` is sent as JSON on stdin. */
function gh(path, { method = 'GET', body, accept, paginate = false } = {}) {
  const args = ['api', path, '-X', method];
  if (accept) args.push('-H', `Accept: ${accept}`);
  if (paginate) args.push('--paginate', '--slurp');
  if (body) args.push('--input', '-');
  const out = execFileSync('gh', args, {
    encoding: 'utf8',
    input: body ? JSON.stringify(body) : undefined,
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  const json = out.trim() ? JSON.parse(out) : null;
  return paginate ? json.flat() : json;
}

function parseArgs(argv) {
  const opts = { images: [], layout: null, pr: null, refresh: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i];
      if (!v) fail(`${a.split('=')[0]} needs a value`);
      return v;
    };
    if (a === '--layout' || a.startsWith('--layout=')) opts.layout = value();
    else if (a === '--pr' || a.startsWith('--pr=')) opts.pr = Number(value());
    else if (a === '--refresh') opts.refresh = true;
    else if (a === '-h' || a === '--help') {
      console.log('usage: npm run pr:screenshots -- [--layout proof.md] [--pr N] <image>...\n       npm run pr:screenshots -- --refresh [--pr N]');
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

function postComment(slug, pr, folder, assetsSha, uploaded) {
  // -z: unquoted paths, so non-ASCII file names survive.
  const paths = git(['ls-tree', '-r', '-z', '--full-tree', '--name-only', assetsSha, '--', `${folder}/`]).split('\0').filter(Boolean);
  const batches = groupBatches(paths, folder);
  if (batches.length === 0) throw new Error(`no screenshots under ${ASSETS_BRANCH}/${folder}/`);
  // Pin links to the last commit that touched this folder, so a --refresh
  // after other PRs' uploads produces the same comment.
  const sha = git(['log', '-1', '--format=%H', assetsSha, '--', `:(top)${folder}`]);
  const latest = batches[batches.length - 1];
  if (uploaded) {
    const shown = new Set(latest.images.map((img) => img.path));
    const lost = uploaded.filter((path) => !shown.has(path));
    if (latest.stamp !== uploaded[0].split('/')[1] || lost.length > 0) {
      throw new Error(`the comment would leave out ${lost.join(', ') || 'this upload'}; please report this as a pr:screenshots bug`);
    }
  }
  const proofMarkdown = latest.proofPath ? git(['show', `${sha}:${latest.proofPath}`]) : null;
  const body = renderComment({ repoSlug: slug, sha, batches, proofMarkdown });

  const comments = gh(`repos/${slug}/issues/${pr}/comments?per_page=100`, { paginate: true });
  const existing = comments.find((c) => c.body?.startsWith(COMMENT_MARKER));
  const post = () => gh(`repos/${slug}/issues/${pr}/comments`, { method: 'POST', body: { body } });
  let comment;
  let action = 'Updated';
  if (!existing) {
    action = 'Posted';
    comment = post();
  } else if (!existing.body.startsWith(body)) {
    // startsWith: the posting proxy may append an attribution footer.
    try {
      comment = gh(`repos/${slug}/issues/comments/${existing.id}`, { method: 'PATCH', body: { body } });
    } catch (e) {
      // Someone else's comment we may not edit: post our own instead.
      if (!/HTTP 403/.test(stderrOf(e))) throw e;
      action = 'Posted';
      comment = post();
    }
  } else {
    action = 'Unchanged';
    comment = existing;
  }

  // Confirm GitHub renders every image of the newest upload.
  const html = gh(`repos/${slug}/issues/comments/${comment.id}`, { accept: 'application/vnd.github.html+json' }).body_html;
  const missing = missingImages(html, slug, sha, latest.images);
  console.log(`${action} Visual proof comment: ${comment.html_url}`);
  if (missing.length > 0) {
    throw new Error(
      `GitHub isn't rendering ${missing.map((m) => m.name).join(', ')} as images. Check the --layout file's image references. ` +
        "In a cloud session, links to screenshots this session didn't upload get defanged: re-run with the image files to re-upload them.",
    );
  }
  console.log(`Verified: GitHub renders all ${latest.images.length} image(s).`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch === 'HEAD') fail('detached HEAD; check out the PR branch first');
  const slug = git(['remote', 'get-url', 'origin']).replace(/\.git$/, '').replace(/^.*[:/]([^/]+\/[^/]+)$/, '$1');
  const folder = folderForBranch(branch);

  let assetsSha;
  let uploaded = null;
  if (opts.refresh) {
    assetsSha = fetchAssets();
    if (!assetsSha) fail(`no ${ASSETS_BRANCH} branch yet; upload some screenshots first`);
  } else {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const batch = `${folder}/${stamp}`;
    assetsSha = upload(opts.images, opts.layout, batch, branch);
    uploaded = opts.images.map((f) => `${batch}/${safeFileName(basename(f))}`);
    console.log(`Uploaded ${opts.images.length} image(s) to ${ASSETS_BRANCH}/${batch} (${assetsSha.slice(0, 7)}).`);
  }

  const pr = opts.pr ?? findPr(slug, branch);
  if (!pr) {
    console.log(`No open PR for ${branch} yet. After opening it, run: npm run pr:screenshots -- --refresh`);
    return;
  }
  postComment(slug, pr, folder, assetsSha, uploaded);
}

try {
  main();
} catch (e) {
  fail(e.message);
}
