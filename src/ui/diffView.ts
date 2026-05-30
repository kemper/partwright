// Diff view — side-by-side code comparison between two session versions

import { MergeView } from '@codemirror/merge';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';
import { getTheme } from './theme';
import { basicSetup } from 'codemirror';
import { listCurrentVersions, effectiveVersionLanguage, getState, type Version } from '../storage/sessionManager';
import { languageExt } from '../editor/codeEditor';

let diffEl: HTMLElement | null = null;
let mergeView: MergeView | null = null;
let onLoadCode: ((code: string) => void) | null = null;

export function createDiffView(container: HTMLElement, loadCode: (code: string) => void): void {
  diffEl = container;
  onLoadCode = loadCode;

  window.addEventListener('session-changed', () => {
    // Destroy stale merge view when session changes
    destroyMergeView();
    if (diffEl && !diffEl.classList.contains('hidden')) refreshDiff();
  });
}

export async function refreshDiff(): Promise<void> {
  if (!diffEl) return;

  const versions = await listCurrentVersions();

  // Clear everything except the merge view (which we manage separately)
  destroyMergeView();
  diffEl.innerHTML = '';

  if (versions.length < 2) {
    const empty = document.createElement('div');
    empty.className = 'flex items-center justify-center h-full text-zinc-500 text-sm';
    empty.textContent = versions.length === 0
      ? 'No versions saved yet. Save at least 2 versions to compare.'
      : 'Only 1 version saved. Save another version to compare.';
    diffEl.appendChild(empty);
    return;
  }

  // Build the UI
  const wrapper = document.createElement('div');
  wrapper.className = 'flex flex-col h-full';

  // --- Controls bar ---
  const controls = document.createElement('div');
  controls.className = 'flex items-center gap-3 px-4 py-2 bg-zinc-800 border-b border-zinc-700 shrink-0 flex-wrap';

  const labelA = document.createElement('span');
  labelA.className = 'text-xs text-zinc-400 font-mono';
  labelA.textContent = 'From:';

  const selectA = createVersionSelect(versions, versions.length - 2);

  const labelB = document.createElement('span');
  labelB.className = 'text-xs text-zinc-400 font-mono';
  labelB.textContent = 'To:';

  const selectB = createVersionSelect(versions, versions.length - 1);

  const swapBtn = document.createElement('button');
  swapBtn.className = 'px-2 py-1 rounded text-xs bg-zinc-700 text-zinc-300 hover:bg-zinc-600 transition-colors';
  swapBtn.textContent = '\u21C4 Swap';
  swapBtn.title = 'Swap left and right versions';
  swapBtn.addEventListener('click', () => {
    const tmp = selectA.value;
    selectA.value = selectB.value;
    selectB.value = tmp;
    renderDiff(versions, parseInt(selectA.value), parseInt(selectB.value), mergeContainer, statsContainer);
  });

  const loadLeftBtn = document.createElement('button');
  loadLeftBtn.className = 'px-2 py-1 rounded text-xs bg-zinc-700 text-zinc-300 hover:bg-zinc-600 transition-colors ml-auto';
  loadLeftBtn.textContent = 'Load Left';
  loadLeftBtn.title = 'Load the left version into the editor';
  loadLeftBtn.addEventListener('click', () => {
    const v = versions.find(v => v.index === parseInt(selectA.value));
    if (v && onLoadCode) onLoadCode(v.code);
  });

  const loadRightBtn = document.createElement('button');
  loadRightBtn.className = 'px-2 py-1 rounded text-xs bg-zinc-700 text-zinc-300 hover:bg-zinc-600 transition-colors';
  loadRightBtn.textContent = 'Load Right';
  loadRightBtn.title = 'Load the right version into the editor';
  loadRightBtn.addEventListener('click', () => {
    const v = versions.find(v => v.index === parseInt(selectB.value));
    if (v && onLoadCode) onLoadCode(v.code);
  });

  controls.appendChild(labelA);
  controls.appendChild(selectA);
  controls.appendChild(labelB);
  controls.appendChild(selectB);
  controls.appendChild(swapBtn);
  controls.appendChild(loadLeftBtn);
  controls.appendChild(loadRightBtn);

  // --- Stats delta bar ---
  const statsContainer = document.createElement('div');
  statsContainer.className = 'px-4 py-2 bg-zinc-800 border-b border-zinc-700 shrink-0';

  // --- Merge view container ---
  const mergeContainer = document.createElement('div');
  mergeContainer.className = 'flex-1 min-h-0 overflow-auto';

  wrapper.appendChild(controls);
  wrapper.appendChild(statsContainer);
  wrapper.appendChild(mergeContainer);
  diffEl.appendChild(wrapper);

  // Wire up select changes
  const onSelectChange = () => {
    renderDiff(versions, parseInt(selectA.value), parseInt(selectB.value), mergeContainer, statsContainer);
  };
  selectA.addEventListener('change', onSelectChange);
  selectB.addEventListener('change', onSelectChange);

  // Initial render
  renderDiff(versions, parseInt(selectA.value), parseInt(selectB.value), mergeContainer, statsContainer);
}

function createVersionSelect(versions: Version[], selectedIdx: number): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'bg-zinc-700 text-zinc-200 text-xs font-mono rounded px-2 py-1 border border-zinc-600 focus:border-blue-500 focus:outline-none';

  for (const v of versions) {
    const opt = document.createElement('option');
    opt.value = String(v.index);
    opt.textContent = `v${v.index} — ${v.label}`;
    if (v.index === versions[selectedIdx]?.index) opt.selected = true;
    select.appendChild(opt);
  }

  return select;
}

function renderDiff(
  versions: Version[],
  indexA: number,
  indexB: number,
  mergeContainer: HTMLElement,
  statsContainer: HTMLElement,
): void {
  const vA = versions.find(v => v.index === indexA);
  const vB = versions.find(v => v.index === indexB);
  if (!vA || !vB) return;

  // Render stats delta
  renderStatsDelta(vA, vB, statsContainer);

  // Destroy previous merge view
  destroyMergeView();
  mergeContainer.innerHTML = '';

  const readOnlyExt = EditorState.readOnly.of(true);
  const themeExt = EditorView.theme({
    '&': { height: '100%', fontSize: '13px' },
    '.cm-scroller': { overflow: 'auto' },
    '.cm-content': { fontFamily: 'monospace' },
  });

  const cmTheme = getTheme() === 'dark' ? [oneDark] : [];
  const session = getState().session;
  const langA = languageExt(effectiveVersionLanguage(vA, session));
  const langB = languageExt(effectiveVersionLanguage(vB, session));
  mergeView = new MergeView({
    a: {
      doc: vA.code,
      extensions: [basicSetup, langA, ...cmTheme, readOnlyExt, themeExt],
    },
    b: {
      doc: vB.code,
      extensions: [basicSetup, langB, ...cmTheme, readOnlyExt, themeExt],
    },
    parent: mergeContainer,
    highlightChanges: true,
    gutter: true,
    collapseUnchanged: { margin: 3, minSize: 6 },
  });

  // Style the merge view container
  mergeView.dom.style.height = '100%';
  mergeView.dom.style.overflow = 'auto';
}

function renderStatsDelta(vA: Version, vB: Version, container: HTMLElement): void {
  container.innerHTML = '';

  const gdA = vA.geometryData;
  const gdB = vB.geometryData;

  if (!gdA || !gdB || gdA.status !== 'ok' || gdB.status !== 'ok') {
    const msg = document.createElement('div');
    msg.className = 'text-xs text-zinc-500 font-mono';
    if (!gdA && !gdB) {
      msg.textContent = 'No geometry data for either version.';
    } else if (gdA?.status === 'error' || gdB?.status === 'error') {
      msg.textContent = 'One or both versions had geometry errors.';
    } else {
      msg.textContent = 'Geometry data unavailable for comparison.';
    }
    container.appendChild(msg);
    return;
  }

  const row = document.createElement('div');
  row.className = 'flex items-center gap-4 flex-wrap';

  // Compare numeric fields
  const fields: { key: string; label: string; decimals: number }[] = [
    { key: 'volume', label: 'Volume', decimals: 1 },
    { key: 'surfaceArea', label: 'Surface Area', decimals: 1 },
    { key: 'componentCount', label: 'Components', decimals: 0 },
    { key: 'genus', label: 'Genus', decimals: 0 },
  ];

  for (const { key, label, decimals } of fields) {
    const a = gdA[key] as number | undefined;
    const b = gdB[key] as number | undefined;
    if (a === undefined || b === undefined) continue;

    const delta = b - a;
    const pct = a !== 0 ? ((delta / a) * 100) : null;

    const chip = document.createElement('span');
    chip.className = 'text-xs font-mono px-2 py-0.5 rounded';

    const valStr = `${a.toFixed(decimals)} \u2192 ${b.toFixed(decimals)}`;

    if (delta === 0) {
      chip.className += ' bg-zinc-700/50 text-zinc-400';
      chip.textContent = `${label}: ${valStr}`;
    } else {
      const sign = delta > 0 ? '+' : '';
      const pctStr = pct !== null ? ` (${sign}${pct.toFixed(1)}%)` : '';
      chip.className += delta > 0 ? ' bg-emerald-900/40 text-emerald-400' : ' bg-red-900/40 text-red-400';
      chip.textContent = `${label}: ${valStr} ${sign}${delta.toFixed(decimals)}${pctStr}`;
    }

    row.appendChild(chip);
  }

  // Bounding box dimensions
  const bbA = gdA.boundingBox as { dimensions?: number[] } | undefined;
  const bbB = gdB.boundingBox as { dimensions?: number[] } | undefined;
  if (bbA?.dimensions && bbB?.dimensions) {
    const dA = bbA.dimensions;
    const dB = bbB.dimensions;
    const chip = document.createElement('span');
    chip.className = 'text-xs font-mono px-2 py-0.5 rounded bg-zinc-700/50 text-zinc-400';
    chip.textContent = `Dims: ${fmtDims(dA)} \u2192 ${fmtDims(dB)}`;
    row.appendChild(chip);
  }

  // Manifold status
  const imA = gdA.isManifold as boolean | undefined;
  const imB = gdB.isManifold as boolean | undefined;
  if (imA !== undefined && imB !== undefined && imA !== imB) {
    const chip = document.createElement('span');
    chip.className = 'text-xs font-mono px-2 py-0.5 rounded';
    chip.className += imB ? ' bg-emerald-900/40 text-emerald-400' : ' bg-red-900/40 text-red-400';
    chip.textContent = `Manifold: ${imA} \u2192 ${imB}`;
    row.appendChild(chip);
  }

  container.appendChild(row);
}

function fmtDims(d: number[]): string {
  return `${d[0].toFixed(0)}\u00D7${d[1].toFixed(0)}\u00D7${d[2].toFixed(0)}`;
}

function destroyMergeView(): void {
  if (mergeView) {
    mergeView.destroy();
    mergeView = null;
  }
}
