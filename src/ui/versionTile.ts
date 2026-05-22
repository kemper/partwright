// Shared version tile — rendered by the Gallery (read-only) and the Versions
// tab (with rename/delete controls). Shows a thumbnail, label, timestamp,
// color-region swatches, geometry stats, and notes for one saved version.

import type { Version } from '../storage/sessionManager';

export interface VersionTileControl {
  /** Glyph or short text shown on the button. */
  label: string;
  title: string;
  onClick: (version: Version) => void;
  /** Style the button as a destructive action. */
  danger?: boolean;
}

export interface VersionTileOptions {
  /** Click handler for the tile body (e.g. load the version). */
  onClick?: (version: Version) => void;
  /** Management buttons overlaid on the thumbnail's top-right corner. */
  controls?: VersionTileControl[];
  /** Highlight this tile as the currently-active version. */
  active?: boolean;
}

export function createVersionTile(version: Version, options: VersionTileOptions = {}): HTMLElement {
  const { onClick, controls, active } = options;

  const tile = document.createElement('div');
  tile.className =
    'relative bg-zinc-800 rounded-lg overflow-hidden transition-all group ' +
    (onClick ? 'cursor-pointer hover:ring-2 hover:ring-blue-500 ' : '') +
    (active ? 'ring-2 ring-emerald-500' : '');
  if (onClick) tile.addEventListener('click', () => onClick(version));

  // Thumbnail
  const thumbContainer = document.createElement('div');
  thumbContainer.className = 'aspect-square bg-zinc-900 flex items-center justify-center overflow-hidden';
  if (version.thumbnail) {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(version.thumbnail);
    img.className = 'w-full h-full object-contain';
    img.addEventListener('load', () => URL.revokeObjectURL(img.src));
    thumbContainer.appendChild(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'text-zinc-600 text-3xl';
    placeholder.textContent = '⬡';
    thumbContainer.appendChild(placeholder);
  }
  tile.appendChild(thumbContainer);

  // "current" badge (top-left)
  if (active) {
    const badge = document.createElement('div');
    badge.className = 'absolute top-1.5 left-1.5 text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-600 text-white';
    badge.textContent = 'current';
    tile.appendChild(badge);
  }

  // Management controls (top-right) — revealed on hover/focus.
  if (controls && controls.length > 0) {
    const bar = document.createElement('div');
    bar.className =
      'absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity';
    for (const ctl of controls) {
      const btn = document.createElement('button');
      btn.className =
        'w-7 h-7 rounded flex items-center justify-center text-xs backdrop-blur border ' +
        (ctl.danger
          ? 'bg-zinc-900/80 text-red-300 border-red-500/40 hover:bg-red-600 hover:text-white'
          : 'bg-zinc-900/80 text-zinc-200 border-zinc-600/60 hover:bg-zinc-700');
      btn.textContent = ctl.label;
      btn.title = ctl.title;
      // Stop propagation so the control doesn't also trigger the tile's onClick.
      btn.addEventListener('click', (e) => { e.stopPropagation(); ctl.onClick(version); });
      bar.appendChild(btn);
    }
    tile.appendChild(bar);
  }

  // Info bar
  const info = document.createElement('div');
  info.className = 'px-3 py-2 space-y-1';

  const header = document.createElement('div');
  header.className = 'flex items-center justify-between';

  const label = document.createElement('span');
  label.className = 'text-xs font-mono font-medium text-zinc-200 truncate';
  label.textContent = version.label;
  header.appendChild(label);

  const time = document.createElement('span');
  time.className = 'text-xs text-zinc-500 shrink-0 ml-2';
  time.textContent = formatTime(version.timestamp);
  header.appendChild(time);

  info.appendChild(header);

  // Color region swatches
  if (version.geometryData) {
    const colorRegions = (version.geometryData as Record<string, unknown>).colorRegions as
      { color: [number, number, number] }[] | undefined;
    if (colorRegions && colorRegions.length > 0) {
      const badge = document.createElement('div');
      badge.className = 'flex items-center gap-0.5 ml-1';
      badge.title = `${colorRegions.length} color region${colorRegions.length > 1 ? 's' : ''}`;
      for (const region of colorRegions.slice(0, 3)) {
        const dot = document.createElement('span');
        dot.className = 'inline-block w-2.5 h-2.5 rounded-sm';
        const [r, g, b] = region.color;
        dot.style.backgroundColor = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
        badge.appendChild(dot);
      }
      if (colorRegions.length > 3) {
        const more = document.createElement('span');
        more.className = 'text-[9px] text-zinc-500';
        more.textContent = `+${colorRegions.length - 3}`;
        badge.appendChild(more);
      }
      header.appendChild(badge);
    }
  }

  // Stats from geometryData
  if (version.geometryData) {
    const stats = document.createElement('div');
    stats.className = 'text-xs text-zinc-500 font-mono';
    const gd = version.geometryData;
    const parts: string[] = [];

    if (gd.status === 'ok') {
      if (typeof gd.volume === 'number') parts.push(`vol: ${(gd.volume as number).toFixed(0)}`);
      const bbox = gd.boundingBox as { dimensions?: number[] } | null;
      if (bbox?.dimensions) {
        const d = bbox.dimensions;
        parts.push(`${d[0].toFixed(0)}×${d[1].toFixed(0)}×${d[2].toFixed(0)}`);
      }
      stats.textContent = parts.join(' · ');

      const dot = document.createElement('span');
      dot.className = 'inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 ml-1';
      dot.style.verticalAlign = 'middle';
      label.appendChild(dot);
    } else if (gd.status === 'error') {
      stats.textContent = `Error: ${gd.error}`;
      stats.className += ' text-red-400';

      const dot = document.createElement('span');
      dot.className = 'inline-block w-1.5 h-1.5 rounded-full bg-red-500 ml-1';
      dot.style.verticalAlign = 'middle';
      label.appendChild(dot);
    }

    info.appendChild(stats);
  }

  // Version notes (design rationale)
  if (version.notes) {
    const notesEl = document.createElement('div');
    notesEl.className = 'text-xs text-zinc-400 mt-1 line-clamp-2';
    notesEl.textContent = version.notes;
    notesEl.title = version.notes;
    info.appendChild(notesEl);
  }

  tile.appendChild(info);
  return tile;
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
