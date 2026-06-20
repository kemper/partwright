// "Publish to a print site" — the assisted-publish modal.
//
// These platforms (Printables / MakerWorld / Thingiverse / Thangs) have no
// public upload API a static site can call, so Partwright can't upload for the
// user. Instead this flow PREPARES the publish: it picks the right file format
// for the chosen platform, downloads the model file + a cover image, copies a
// title/description/tags block to the clipboard, and opens the platform's
// upload page in a new tab — so the user just drops the file and pastes.
//
// The data/string logic lives in src/publish/publishTargets.ts (unit-tested);
// this module is the DOM shell + wiring.

import { createModalShell } from './modalShell';
import { BUTTON_PRIMARY, BUTTON_CANCEL, BUTTON_SMALL_SECONDARY } from './styleConstants';
import { escapeHtml } from './htmlUtils';
import { showToast } from './toast';
import {
  PUBLISH_TARGETS,
  recommendedFormat,
  buildDefaultDescription,
  composeClipboardText,
  parseTags,
  type PublishTarget,
  type PublishFormat,
} from '../publish/publishTargets';

export interface PublishModalContext {
  /** Default title (usually the session name). */
  defaultTitle: string;
  /** Optional model stats used to enrich the default description. */
  stats?: { dims?: [number, number, number] | null; units?: string } | null;
  /** Build a single ZIP bundle (model file + optional cover PNG + details.txt)
   *  so the user gets ONE download instead of several files (which trips the
   *  browser's "open multiple files?" prompt). Returns null if there's no
   *  geometry. */
  buildBundle: (opts: {
    format: PublishFormat;
    includeCover: boolean;
    detailsText: string;
  }) => Promise<{ blob: Blob; filename: string } | null>;
  /** Trigger a browser download (the app's downloadBlob). */
  download: (blob: Blob, filename: string) => void;
  /** Optional platform id to preselect. */
  preselect?: string;
}

const FORMAT_LABELS: Record<PublishFormat, string> = {
  stl: 'STL',
  '3mf': '3MF (keeps colours)',
  '3mf-bambu': '3MF — MakerWorld/Bambu',
  glb: 'GLB',
  obj: 'OBJ',
};

export function openPublishModal(ctx: PublishModalContext): void {
  let target: PublishTarget =
    PUBLISH_TARGETS.find(t => t.id === ctx.preselect) ?? PUBLISH_TARGETS[0];
  let format: PublishFormat = recommendedFormat(target);

  const shell = createModalShell({ title: 'Publish to a print site', maxWidth: 'lg', scrollable: true });

  // Assisted-publish explanation — sets expectations up front.
  const intro = document.createElement('p');
  intro.className = 'text-xs text-zinc-400 leading-snug';
  intro.innerHTML =
    'These sites have no public upload API, so Partwright can’t post for you. ' +
    'It prepares everything instead: it downloads a single <strong>ZIP</strong> with the model file, ' +
    'a cover image, and a <span class="font-mono">details.txt</span> (also copied to your clipboard), ' +
    'then opens the upload page — unzip, drop the files, and paste.';
  shell.body.appendChild(intro);

  // --- Platform pills ---
  const pillRow = document.createElement('div');
  pillRow.className = 'flex flex-wrap gap-2';
  const pills: HTMLButtonElement[] = [];
  for (const t of PUBLISH_TARGETS) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.textContent = t.label;
    pill.dataset.targetId = t.id;
    pillRow.appendChild(pill);
    pills.push(pill);
    pill.addEventListener('click', () => {
      target = t;
      format = recommendedFormat(target);
      syncTarget();
    });
  }
  shell.body.appendChild(pillRow);

  // Platform notes line.
  const notesEl = document.createElement('p');
  notesEl.className = 'text-xs text-zinc-400 leading-snug';
  shell.body.appendChild(notesEl);

  // --- Format select ---
  const formatRow = document.createElement('label');
  formatRow.className = 'flex items-center gap-2 text-xs font-medium text-zinc-300';
  formatRow.textContent = 'File format:';
  const formatSelect = document.createElement('select');
  formatSelect.className = 'text-xs bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-zinc-200 focus:outline-none focus:border-blue-500';
  formatRow.appendChild(formatSelect);
  formatSelect.addEventListener('change', () => { format = formatSelect.value as PublishFormat; });
  shell.body.appendChild(formatRow);

  // --- Title ---
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.value = ctx.defaultTitle || 'My model';
  titleInput.placeholder = 'Model title';
  titleInput.className = 'w-full bg-zinc-900 border border-zinc-600 rounded px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-blue-500';
  shell.body.appendChild(fieldGroup('Title', titleInput));

  // --- Description ---
  const descInput = document.createElement('textarea');
  descInput.rows = 4;
  descInput.value = buildDefaultDescription(ctx.defaultTitle || 'My model', ctx.stats ?? undefined);
  descInput.className = 'w-full bg-zinc-900 border border-zinc-600 rounded px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-blue-500 resize-y';
  shell.body.appendChild(fieldGroup('Description', descInput));

  // --- Tags ---
  const tagsInput = document.createElement('input');
  tagsInput.type = 'text';
  tagsInput.placeholder = 'comma, separated, tags';
  tagsInput.className = 'w-full bg-zinc-900 border border-zinc-600 rounded px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-blue-500';
  shell.body.appendChild(fieldGroup('Tags', tagsInput));

  // --- Include cover checkbox ---
  const coverLabel = document.createElement('label');
  coverLabel.className = 'flex items-center gap-2 text-xs text-zinc-300';
  const coverCheck = document.createElement('input');
  coverCheck.type = 'checkbox';
  coverCheck.checked = true;
  coverCheck.className = 'accent-blue-600';
  coverLabel.append(coverCheck, document.createTextNode('Include a cover image (PNG) in the ZIP'));
  shell.body.appendChild(coverLabel);

  // --- Footer ---
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = BUTTON_CANCEL;
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => shell.close());

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = BUTTON_SMALL_SECONDARY;
  copyBtn.textContent = 'Copy details';
  copyBtn.addEventListener('click', () => { void copyDetails(); });

  const goBtn = document.createElement('button');
  goBtn.type = 'button';
  goBtn.className = BUTTON_PRIMARY;
  goBtn.addEventListener('click', () => { void prepareAndOpen(); });

  shell.footer.append(cancelBtn, copyBtn, goBtn);

  function currentMeta() {
    return {
      title: titleInput.value,
      description: descInput.value,
      tags: parseTags(tagsInput.value),
    };
  }

  async function copyDetails(): Promise<void> {
    const text = composeClipboardText(currentMeta());
    try {
      await navigator.clipboard.writeText(text);
      showToast('Title, description & tags copied to clipboard.', { variant: 'success' });
    } catch {
      showToast('Could not access the clipboard.', { variant: 'warn' });
    }
  }

  async function prepareAndOpen(): Promise<void> {
    goBtn.disabled = true;
    const originalLabel = goBtn.textContent;
    goBtn.textContent = 'Preparing…';
    try {
      const detailsText = composeClipboardText(currentMeta());
      const bundle = await ctx.buildBundle({
        format,
        includeCover: coverCheck.checked,
        detailsText,
      });
      if (!bundle) {
        showToast('No geometry to publish — run a model first.', { variant: 'warn' });
        return;
      }
      ctx.download(bundle.blob, bundle.filename);

      // Best-effort clipboard copy — never block the open on a clipboard denial.
      try { await navigator.clipboard.writeText(detailsText); } catch { /* ignore */ }

      window.open(target.uploadUrl, '_blank', 'noopener,noreferrer');
      showToast(
        `Downloaded ${bundle.filename} and copied the details. ` +
        `Unzip it, drop the files on the ${target.label} upload page, and paste.`,
        { variant: 'success' },
      );
      shell.close();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not prepare the publish.', { variant: 'warn' });
    } finally {
      goBtn.disabled = false;
      goBtn.textContent = originalLabel;
    }
  }

  // Re-render everything that depends on the selected platform.
  function syncTarget(): void {
    for (const pill of pills) {
      const selected = pill.dataset.targetId === target.id;
      pill.className = selected
        ? 'px-3 py-1 rounded-lg text-xs font-medium bg-blue-600 text-white'
        : 'px-3 py-1 rounded-lg text-xs font-medium bg-zinc-700 text-zinc-300 hover:bg-zinc-600';
    }
    notesEl.innerHTML = escapeHtml(target.notes);

    formatSelect.replaceChildren();
    for (const f of target.formats) {
      const opt = document.createElement('option');
      opt.value = f;
      opt.textContent = FORMAT_LABELS[f] + (f === recommendedFormat(target) ? ' — recommended' : '');
      formatSelect.appendChild(opt);
    }
    formatSelect.value = format;

    goBtn.textContent = `Download & open ${target.label}`;
  }

  syncTarget();
  requestAnimationFrame(() => titleInput.focus());
}

/** A labeled vertical field group (label above the control). */
function fieldGroup(label: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'flex flex-col gap-1';
  const lbl = document.createElement('span');
  lbl.className = 'text-xs font-medium text-zinc-300';
  lbl.textContent = label;
  wrap.append(lbl, control);
  return wrap;
}
