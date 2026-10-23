// Pure helpers for the PR "Visual proof" comment written by
// `npm run pr:screenshots` (scripts/pr-screenshots.mjs).
//
// Screenshots live on the never-merged `pr-assets` branch, one folder per PR
// branch and one sub-folder per upload ("batch"):
//
//   <folder>/<YYYYMMDD-HHMMSS>/<image>…   (+ optional proof.md layout)
//
// The script renders that folder into one PR comment with these helpers, so
// image links are generated, never hand-typed, and nothing lands in the PR
// branch's history.

export const COMMENT_MARKER = '<!-- pr-visual-proof -->';

const STAMP_RE = /^\d{8}-\d{6}$/;
const IMAGE_RE = /\.(png|jpe?g|gif|webp)$/i;

/** pr-assets folder for a PR head branch. */
export function folderForBranch(branch) {
  return branch.replace(/\//g, '-');
}

/**
 * Group the pr-assets paths under `folder` into upload batches, oldest first.
 * Understands the current `<stamp>/<file>` layout and the older flat
 * `<stamp>-<file>` one, so PRs that already have screenshots still render.
 * Returns `[{ stamp, images: [{ name, path }], proofPath }]`.
 */
export function groupBatches(paths, folder) {
  const prefix = `${folder}/`;
  const byStamp = new Map();
  const batchFor = (stamp) => {
    if (!byStamp.has(stamp)) byStamp.set(stamp, { stamp, images: [], proofPath: null });
    return byStamp.get(stamp);
  };
  for (const path of paths) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const parts = rest.split('/');
    if (parts.length === 2 && STAMP_RE.test(parts[0])) {
      const [stamp, name] = parts;
      if (name === 'proof.md') batchFor(stamp).proofPath = path;
      else if (IMAGE_RE.test(name)) batchFor(stamp).images.push({ name, path });
    } else if (parts.length === 1 && STAMP_RE.test(rest.slice(0, 15)) && rest[15] === '-' && IMAGE_RE.test(rest)) {
      batchFor(rest.slice(0, 15)).images.push({ name: rest.slice(16), path });
    }
  }
  const batches = [...byStamp.values()].filter((b) => b.images.length > 0);
  for (const b of batches) b.images.sort((a, c) => a.name.localeCompare(c.name));
  return batches.sort((a, b) => a.stamp.localeCompare(b.stamp));
}

/** Image URL pinned to a pr-assets commit; works for public and private repos. */
export function imageUrl(repoSlug, sha, path) {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `https://github.com/${repoSlug}/blob/${sha}/${encoded}?raw=true`;
}

function stampLabel(stamp) {
  return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)} ${stamp.slice(9, 11)}:${stamp.slice(11, 13)} UTC`;
}

function title(name) {
  return name.replace(IMAGE_RE, '').replace(/[[\]|]/g, ' ');
}

/** Default layout: images two to a row, each captioned with its file name. */
function autoLayout(images, urlFor) {
  const rows = [];
  for (let i = 0; i < images.length; i += 2) {
    const pair = images.slice(i, i + 2);
    rows.push(
      [
        `| ${pair.map((img) => title(img.name)).join(' | ')} |`,
        `|${pair.map(() => '---').join('|')}|`,
        `| ${pair.map((img) => `![${title(img.name)}](${urlFor(img.path)})`).join(' | ')} |`,
      ].join('\n'),
    );
  }
  return rows.join('\n\n');
}

/**
 * Point the relative image references in an uploaded proof.md at the batch's
 * pinned URLs: `![x](after.png)` and `<img src="after.png">`. Anything that
 * isn't one of the batch's own files is left alone.
 */
export function resolveProofMarkdown(markdown, batch, urlFor) {
  const byName = new Map(batch.images.map((img) => [img.name, urlFor(img.path)]));
  const swap = (ref) => byName.get(ref.replace(/^\.\//, '')) ?? ref;
  return markdown
    .replace(/(!\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g, (_, open, ref, close) => open + swap(ref) + close)
    .replace(/(<img\b[^>]*\bsrc=")([^"]+)(")/gi, (_, open, ref, close) => open + swap(ref) + close);
}

/**
 * The full comment body. The newest batch is shown inline (its proof.md
 * layout, else the auto layout); earlier batches collapse to links.
 */
export function renderComment({ repoSlug, sha, batches, proofMarkdown = null }) {
  const urlFor = (path) => imageUrl(repoSlug, sha, path);
  const latest = batches[batches.length - 1];
  const out = [COMMENT_MARKER, '## Visual proof', ''];
  out.push(proofMarkdown ? resolveProofMarkdown(proofMarkdown.trim(), latest, urlFor) : autoLayout(latest.images, urlFor));
  const earlier = batches.slice(0, -1).reverse();
  if (earlier.length > 0) {
    out.push('', `<details><summary>Earlier screenshots (${earlier.length} upload${earlier.length === 1 ? '' : 's'})</summary>`, '');
    for (const b of earlier) {
      out.push(`- ${stampLabel(b.stamp)}: ${b.images.map((img) => `[${title(img.name)}](${urlFor(img.path)})`).join(' · ')}`);
    }
    out.push('', '</details>');
  }
  out.push(
    '',
    `<sub>Uploaded ${stampLabel(latest.stamp)} with <code>npm run pr:screenshots</code> (pr-assets@${sha.slice(0, 7)}). This comment is updated in place on each new upload.</sub>`,
  );
  return out.join('\n');
}

/**
 * The pinned screenshot URLs GitHub actually rendered as images in a comment's
 * HTML (`Accept: application/vnd.github.html+json`), used to confirm the
 * comment shows every image rather than a broken link.
 */
export function renderedImageSrcs(html, repoSlug) {
  const prefix = `https://github.com/${repoSlug}/blob/`;
  const srcs = [];
  for (const m of html.matchAll(/<img\b[^>]*?\bsrc="([^"]+)"/gi)) {
    const src = m[1].replace(/&amp;/g, '&');
    if (src.startsWith(prefix)) srcs.push(src);
  }
  return srcs;
}
