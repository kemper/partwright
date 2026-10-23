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

/**
 * The name an image is stored under on pr-assets: only [A-Za-z0-9._-], so its
 * URL needs no percent-encoding. Cloud sessions' GitHub proxy defangs image
 * links (wraps them in backticks) unless they literally match a path the
 * session itself pushed, and an encoded name never matches.
 */
export function safeFileName(name) {
  return name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+(?=\.[^.]+$)/g, '') || 'image';
}

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

// encodeURIComponent leaves !'()* alone; a bare ")" would end a Markdown link.
function encodeSegment(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Image URL pinned to a pr-assets commit; works for public and private repos. */
export function imageUrl(repoSlug, sha, path) {
  const encoded = path.split('/').map(encodeSegment).join('/');
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
 * Point the image references in an uploaded proof.md at the batch's pinned
 * URLs: `![x](after.png)`, `![x](<my shot.png>)` and `<img src="after.png">`,
 * matched by file name (a directory prefix like `test-results/` is ignored),
 * including names with spaces or parentheses. Absolute URLs and names that
 * aren't among the batch's images are left alone.
 */
export function resolveProofMarkdown(markdown, batch, urlFor) {
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let out = markdown;
  for (const img of batch.images) {
    const url = urlFor(img.path);
    const name = escape(img.name);
    out = out
      .replace(new RegExp(`(!\\[[^\\]]*\\]\\()<?(?:[^\\s()<>"]*/)?${name}>?((?:\\s+"[^"]*")?\\))`, 'g'), (_, open, close) => open + url + close)
      .replace(new RegExp(`(<img\\b[^>]*\\bsrc=")(?:[^"]*/)?${name}(")`, 'gi'), (_, open, close) => open + url + close);
  }
  return out;
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
      // Names from before uploads were made URL-safe would get their links
      // defanged (see safeFileName), so those are listed without one.
      const entry = (img) => (safeFileName(img.name) === img.name ? `[${title(img.name)}](${urlFor(img.path)})` : title(img.name));
      out.push(`- ${stampLabel(b.stamp)}: ${b.images.map(entry).join(' · ')}`);
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
 * HTML (`Accept: application/vnd.github.html+json`).
 */
function renderedImageSrcs(html, repoSlug) {
  const prefix = `https://github.com/${repoSlug}/blob/`;
  const srcs = [];
  for (const m of html.matchAll(/<img\b[^>]*?\bsrc="([^"]+)"/gi)) {
    const src = m[1].replace(/&amp;/g, '&');
    if (src.startsWith(prefix)) srcs.push(src);
  }
  return srcs;
}

/** The images GitHub did not render in the comment HTML (empty = all shown). */
export function missingImages(html, repoSlug, sha, images) {
  const shown = new Set(renderedImageSrcs(html, repoSlug).map((src) => src.split('?')[0]));
  return images.filter((img) => !shown.has(imageUrl(repoSlug, sha, img.path).split('?')[0]));
}
