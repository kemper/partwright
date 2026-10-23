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
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  COMMENT_MARKER,
  folderForBranch,
  groupBatches,
  renderComment,
  renderedImageSrcs,
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
      if (a.includes('=')) return a.slice(a.indexOf('=') + 1);
      if (i + 1 >= argv.length) fail(`${a} needs a value`);
      return argv[++i];
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
    if (!existsSync(f)) fail(`no such file: ${f}`);
  }
  for (const f of opts.images) {
    const name = basename(f);
    if (!IMAGE_RE.test(name)) fail(`not an image (png/jpg/gif/webp): ${f}`);
    if (names.has(name)) fail(`two images named ${name}; rename one`);
    names.add(name);
  }
  return opts;
}

function fetchAssets() {
  try {
    git(['fetch', '-q', 'origin', `+refs/heads/${ASSETS_BRANCH}:${ASSETS_REF}`]);
    return git(['rev-parse', ASSETS_REF]);
  } catch {
    return null; // branch doesn't exist yet
  }
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
      const files = images.map((f) => [f, `${batch}/${basename(f)}`]);
      if (layout) files.push([layout, `${batch}/proof.md`]);
      for (const [src, dest] of files) {
        const blob = git(['hash-object', '-w', src]);
        git(['update-index', '--add', '--cacheinfo', `100644,${blob},${dest}`], { env });
      }
      const tree = git(['write-tree'], { env });
      const commit = git(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', `screenshots for ${branch}`]);
      try {
        git(['push', '-q', 'origin', `${commit}:refs/heads/${ASSETS_BRANCH}`]);
        git(['update-ref', ASSETS_REF, commit]);
        return commit;
      } catch {
        console.error(`push to ${ASSETS_BRANCH} rejected (attempt ${attempt}); refetching and retrying…`);
        execFileSync('sleep', [String(attempt * 2)]);
      }
    }
    fail(`could not push to ${ASSETS_BRANCH} after 4 attempts`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function findPr(slug, branch) {
  const owner = slug.split('/')[0];
  const prs = gh(`repos/${slug}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`);
  return prs.length > 0 ? prs[0].number : null;
}

function postComment(slug, pr, folder, assetsSha) {
  const paths = git(['ls-tree', '-r', '--name-only', assetsSha, '--', `${folder}/`]).split('\n').filter(Boolean);
  const batches = groupBatches(paths, folder);
  if (batches.length === 0) fail(`no screenshots under ${ASSETS_BRANCH}/${folder}/`);
  // Pin links to the last commit that touched this folder, so a --refresh
  // after other PRs' uploads produces the same comment.
  const sha = git(['log', '-1', '--format=%H', assetsSha, '--', folder]);
  const latest = batches[batches.length - 1];
  const proofMarkdown = latest.proofPath ? git(['show', `${sha}:${latest.proofPath}`]) : null;
  const body = renderComment({ repoSlug: slug, sha, batches, proofMarkdown });

  const comments = gh(`repos/${slug}/issues/${pr}/comments?per_page=100`, { paginate: true });
  const existing = comments.find((c) => c.body?.startsWith(COMMENT_MARKER));
  let comment;
  let action = 'Updated';
  if (!existing) {
    action = 'Posted';
    comment = gh(`repos/${slug}/issues/${pr}/comments`, { method: 'POST', body: { body } });
  } else if (!existing.body.startsWith(body)) {
    // startsWith: the posting proxy may append an attribution footer.
    comment = gh(`repos/${slug}/issues/comments/${existing.id}`, { method: 'PATCH', body: { body } });
  } else {
    action = 'Unchanged';
    comment = existing;
  }

  // Confirm GitHub renders every image of the newest upload.
  const html = gh(`repos/${slug}/issues/comments/${comment.id}`, { accept: 'application/vnd.github.html+json' }).body_html;
  const shown = renderedImageSrcs(html, slug);
  const missing = latest.images.filter((img) => !shown.some((src) => src.includes(`/${sha}/`) && src.includes(img.path.split('/').map(encodeURIComponent).join('/'))));
  console.log(`${action} Visual proof comment: ${comment.html_url}`);
  if (missing.length > 0) {
    fail(`GitHub isn't rendering ${missing.map((m) => m.name).join(', ')} as images; check the comment (and the --layout file's image references).`);
  }
  console.log(`Verified: GitHub renders all ${latest.images.length} image(s).`);
}

const opts = parseArgs(process.argv.slice(2));
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch === 'HEAD') fail('detached HEAD; check out the PR branch first');
const slug = git(['remote', 'get-url', 'origin']).replace(/\.git$/, '').replace(/^.*[:/]([^/]+\/[^/]+)$/, '$1');
const folder = folderForBranch(branch);

let assetsSha;
if (opts.refresh) {
  assetsSha = fetchAssets();
  if (!assetsSha) fail(`no ${ASSETS_BRANCH} branch yet; upload some screenshots first`);
} else {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  assetsSha = upload(opts.images, opts.layout, `${folder}/${stamp}`, branch);
  console.log(`Uploaded ${opts.images.length} image(s) to ${ASSETS_BRANCH}/${folder}/${stamp} (${assetsSha.slice(0, 7)}).`);
}

const pr = opts.pr ?? findPr(slug, branch);
if (!pr) {
  console.log(`No open PR for ${branch} yet. After opening it, run: npm run pr:screenshots -- --refresh`);
  process.exit(0);
}
postComment(slug, pr, folder, assetsSha);
