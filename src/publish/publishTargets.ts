// Assisted-publish targets — the metadata behind the "Publish to a print site"
// flow. None of these platforms expose a public *upload* API a static site can
// call (Printables/MakerWorld/Thangs have none; Thingiverse's needs a server to
// hold the OAuth client secret), so Partwright can't upload for the user. What
// it CAN do is one-click-prepare the publish: build the right file + a cover
// image, copy a title/description/tags block to the clipboard, and open the
// platform's upload page — turning "publish" into "drop the file, paste, done".
//
// This module is intentionally dependency-free (pure data + string helpers) so
// it unit-tests in the node tier. The DOM flow lives in src/ui/publishModal.ts.

/** Export formats the publish flow can hand to a platform. Mirrors the file
 *  formats Partwright already builds (see src/export/). */
export type PublishFormat = 'stl' | '3mf' | 'glb' | 'obj';

export interface PublishTarget {
  /** Stable id (used by the window.partwright API + tests). */
  id: 'printables' | 'makerworld' | 'thingiverse' | 'thangs';
  /** Display name shown on the platform pill + buttons. */
  label: string;
  /** The platform's upload/new-model page, opened in a new tab. */
  uploadUrl: string;
  /** Accepted formats in preference order; `formats[0]` is the recommended one. */
  formats: PublishFormat[];
  /** One-line guidance shown when this platform is selected. */
  notes: string;
}

/** The recommended (default) format for a target — its first accepted format. */
export function recommendedFormat(target: PublishTarget): PublishFormat {
  return target.formats[0];
}

export const PUBLISH_TARGETS: PublishTarget[] = [
  {
    id: 'printables',
    label: 'Printables',
    uploadUrl: 'https://www.printables.com/model/add',
    formats: ['3mf', 'stl', 'obj'],
    notes: "Prusa's community site. 3MF keeps painted colours; STL is geometry-only.",
  },
  {
    id: 'makerworld',
    label: 'MakerWorld',
    uploadUrl: 'https://makerworld.com/en/upload',
    formats: ['3mf', 'stl'],
    notes: "Bambu's platform — upload a 3MF for colours and printer settings. (It can also import from Printables/Thingiverse.)",
  },
  {
    id: 'thingiverse',
    label: 'Thingiverse',
    uploadUrl: 'https://www.thingiverse.com/upload',
    formats: ['stl', '3mf', 'obj', 'glb'],
    notes: "MakerBot's site. STL is the safest, most widely-supported format here.",
  },
  {
    id: 'thangs',
    label: 'Thangs',
    uploadUrl: 'https://thangs.com/upload',
    formats: ['stl', '3mf', 'obj', 'glb'],
    notes: 'Search-first model host; accepts 30+ formats, including STL and 3MF.',
  },
];

/** Look up a target by id (e.g. from the window.partwright API argument). */
export function findPublishTarget(id: string): PublishTarget | undefined {
  return PUBLISH_TARGETS.find(t => t.id === id);
}

export interface PublishMetadata {
  title: string;
  description: string;
  /** Free tags; blanks are dropped by the composer. */
  tags: string[];
}

/** Normalize a comma/whitespace-separated tag string into a clean tag list. */
export function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map(t => t.trim())
    .filter(t => t.length > 0);
}

/** A short credit line appended to auto-generated descriptions. */
export const PUBLISH_CREDIT = 'Designed with Partwright — https://www.partwrightstudio.com';

/** Build a sensible default description from the model title + optional stats. */
export function buildDefaultDescription(title: string, stats?: {
  dims?: [number, number, number] | null;
  units?: string;
}): string {
  const lines: string[] = [];
  if (title.trim()) lines.push(title.trim());
  if (stats?.dims) {
    const [x, y, z] = stats.dims.map(d => Math.round(d * 100) / 100);
    const unit = stats.units && stats.units !== 'unitless' ? ` ${stats.units}` : '';
    lines.push(`Approx. size: ${x} × ${y} × ${z}${unit}.`);
  }
  lines.push('');
  lines.push(PUBLISH_CREDIT);
  return lines.join('\n');
}

/** Compose the copy-to-clipboard block a user pastes into the upload form. */
export function composeClipboardText(meta: PublishMetadata): string {
  const tags = meta.tags.filter(t => t.trim().length > 0);
  const parts = [
    `Title: ${meta.title.trim()}`,
    '',
    'Description:',
    meta.description.trim(),
  ];
  if (tags.length > 0) {
    parts.push('', `Tags: ${tags.join(', ')}`);
  }
  return parts.join('\n');
}
