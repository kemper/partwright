// Data tab — browse everything Partwright has stored in this browser, starting
// from categories and drilling into entities by id, then a field-level detail
// view. Read-only; deletion is handled by the Uninstall modal (linked here).

import {
  ALL_STORES,
  STORE_LABELS,
  getStoreCounts,
  getStoreRecords,
  listLocalStorageEntries,
  formatBytes,
  type StoreName,
} from '../storage/dataInventory';
import { getStorageUsage, getCachedModels } from '../ai/local';
import { showUninstallModal } from './uninstallModal';
import { onTabSync } from '../storage/tabSync';

type View =
  | { kind: 'home' }
  | { kind: 'store'; store: StoreName }
  | { kind: 'record'; store: StoreName; id: string }
  | { kind: 'localStorage' };

let rootEl: HTMLElement | null = null;
let view: View = { kind: 'home' };

export function initDataExplorer(container: HTMLElement): void {
  rootEl = container;
  // Live-refresh when a peer tab changes data and this tab is visible.
  onTabSync(() => {
    if (rootEl && !rootEl.classList.contains('hidden')) void render();
  });
}

export function refreshDataExplorer(): void {
  void render();
}

function recordKey(store: StoreName, rec: Record<string, unknown>): string {
  if (store === 'aiKeys') return String(rec.provider ?? '');
  return String(rec.id ?? '');
}

function recordLabel(store: StoreName, rec: Record<string, unknown>): string {
  switch (store) {
    case 'sessions': return String(rec.name ?? rec.id ?? '(unnamed)');
    case 'versions': return `v${rec.index ?? '?'} · ${String(rec.label ?? '')}`.trim();
    case 'parts': return String(rec.name ?? rec.id ?? '(unnamed)');
    case 'notes': return truncate(String(rec.text ?? ''), 60);
    case 'aiKeys': return String(rec.provider ?? '');
    case 'aiChats': return `${String(rec.role ?? '?')} · ${truncate(blocksToText(rec.blocks), 50)}`;
    case 'aiAttachments': return String(rec.label || rec.mediaType || rec.id || '');
  }
}

function blocksToText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';
  for (const b of blocks) {
    if (b && typeof b === 'object' && (b as { type?: string }).type === 'text') {
      return String((b as { text?: string }).text ?? '');
    }
  }
  return `${blocks.length} block(s)`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

async function render(): Promise<void> {
  if (!rootEl) return;
  rootEl.replaceChildren();
  rootEl.appendChild(buildHeader());
  if (view.kind === 'home') await renderHome();
  else if (view.kind === 'store') await renderStore(view.store);
  else if (view.kind === 'record') await renderRecord(view.store, view.id);
  else if (view.kind === 'localStorage') renderLocalStorage();
}

function buildHeader(): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'flex items-center gap-2 mb-3 text-xs';

  const crumbs = document.createElement('div');
  crumbs.className = 'flex items-center gap-1 text-zinc-400 flex-1 min-w-0';
  const home = crumbLink('Data', () => { view = { kind: 'home' }; void render(); });
  crumbs.appendChild(home);
  if (view.kind === 'store' || view.kind === 'record') {
    crumbs.appendChild(sep());
    const storeName = view.store;
    crumbs.appendChild(crumbLink(STORE_LABELS[storeName], () => { view = { kind: 'store', store: storeName }; void render(); }));
  }
  if (view.kind === 'record') {
    crumbs.appendChild(sep());
    crumbs.appendChild(crumbText(view.id));
  }
  if (view.kind === 'localStorage') {
    crumbs.appendChild(sep());
    crumbs.appendChild(crumbText('Preferences & settings'));
  }
  bar.appendChild(crumbs);

  const manage = document.createElement('button');
  manage.type = 'button';
  manage.className = 'shrink-0 px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-600';
  manage.textContent = 'Manage / delete data…';
  manage.addEventListener('click', () => showUninstallModal());
  bar.appendChild(manage);

  return bar;
}

function crumbLink(label: string, onClick: () => void): HTMLElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'text-blue-400 hover:text-blue-300 truncate';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function crumbText(label: string): HTMLElement {
  const s = document.createElement('span');
  s.className = 'text-zinc-300 font-mono truncate';
  s.textContent = label;
  return s;
}

function sep(): HTMLElement {
  const s = document.createElement('span');
  s.className = 'text-zinc-600';
  s.textContent = '/';
  return s;
}

function categoryRow(label: string, detail: string, onClick: (() => void) | null): HTMLElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.disabled = !onClick;
  row.className = 'w-full flex items-center justify-between gap-3 px-3 py-2 rounded border border-zinc-700 bg-zinc-800/40 text-left enabled:hover:border-zinc-600 disabled:opacity-60';
  const left = document.createElement('span');
  left.className = 'text-zinc-100 text-sm';
  left.textContent = label;
  const right = document.createElement('span');
  right.className = 'text-zinc-400 text-xs font-mono';
  right.textContent = detail;
  row.append(left, right);
  if (onClick) row.addEventListener('click', onClick);
  return row;
}

async function renderHome(): Promise<void> {
  if (!rootEl) return;
  const list = document.createElement('div');
  list.className = 'flex flex-col gap-2';
  rootEl.appendChild(list);

  // IndexedDB stores
  const heading = (text: string) => {
    const h = document.createElement('div');
    h.className = 'text-[11px] uppercase tracking-wide text-zinc-500 mt-2';
    h.textContent = text;
    return h;
  };
  list.appendChild(heading('IndexedDB'));
  try {
    const counts = await getStoreCounts();
    for (const store of ALL_STORES) {
      const count = counts.find((c) => c.store === store)?.count ?? 0;
      list.appendChild(
        categoryRow(
          STORE_LABELS[store],
          `${count} ${count === 1 ? 'record' : 'records'}`,
          count > 0 ? () => { view = { kind: 'store', store }; void render(); } : null,
        ),
      );
    }
  } catch (err) {
    list.appendChild(errorLine(err));
  }

  list.appendChild(heading('Browser storage'));
  const prefs = listLocalStorageEntries();
  list.appendChild(
    categoryRow('Preferences & settings (localStorage)', `${prefs.length} ${prefs.length === 1 ? 'key' : 'keys'}`,
      prefs.length > 0 ? () => { view = { kind: 'localStorage' }; void render(); } : null),
  );

  // Models + overall usage summary (async).
  const modelsRow = categoryRow('Downloaded AI models', '…', null);
  list.appendChild(modelsRow);
  const usageRow = categoryRow('Total browser storage used', '…', null);
  list.appendChild(usageRow);
  void (async () => {
    try {
      const models = await getCachedModels();
      modelsRow.querySelector('span:last-child')!.textContent = `${models.size} cached`;
    } catch { /* ignore */ }
    try {
      const usage = await getStorageUsage();
      usageRow.querySelector('span:last-child')!.textContent = usage.unavailable
        ? 'unavailable'
        : `${formatBytes(usage.usageBytes)} / ${formatBytes(usage.quotaBytes)}`;
    } catch { /* ignore */ }
  })();
}

async function renderStore(store: StoreName): Promise<void> {
  if (!rootEl) return;
  const list = document.createElement('div');
  list.className = 'flex flex-col gap-1.5';
  rootEl.appendChild(list);
  try {
    const records = (await getStoreRecords(store)) as Record<string, unknown>[];
    if (records.length === 0) {
      list.appendChild(emptyLine('No records.'));
      return;
    }
    for (const rec of records) {
      const id = recordKey(store, rec);
      list.appendChild(
        categoryRow(recordLabel(store, rec), id, () => { view = { kind: 'record', store, id }; void render(); }),
      );
    }
  } catch (err) {
    list.appendChild(errorLine(err));
  }
}

async function renderRecord(store: StoreName, id: string): Promise<void> {
  if (!rootEl) return;
  try {
    const records = (await getStoreRecords(store)) as Record<string, unknown>[];
    const rec = records.find((r) => recordKey(store, r) === id);
    if (!rec) {
      rootEl.appendChild(emptyLine('Record not found (it may have been deleted).'));
      return;
    }
    const table = document.createElement('div');
    table.className = 'flex flex-col gap-2';
    for (const [key, value] of Object.entries(rec)) {
      table.appendChild(fieldRow(store, key, value));
    }
    rootEl.appendChild(table);
  } catch (err) {
    rootEl.appendChild(errorLine(err));
  }
}

function fieldRow(store: StoreName, key: string, value: unknown): HTMLElement {
  const row = document.createElement('div');
  row.className = 'border border-zinc-800 rounded p-2 bg-zinc-800/30';
  const k = document.createElement('div');
  k.className = 'text-[11px] uppercase tracking-wide text-zinc-500 mb-1';
  k.textContent = key;
  row.appendChild(k);

  // Mask secrets: the AI API key.
  if (store === 'aiKeys' && key === 'apiKey' && typeof value === 'string') {
    row.appendChild(buildSecretField(value));
    return row;
  }

  const v = document.createElement('pre');
  v.className = 'text-xs text-zinc-200 whitespace-pre-wrap break-words font-mono m-0';
  v.textContent = summarizeValue(value);
  row.appendChild(v);
  return row;
}

function buildSecretField(secret: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'flex items-center gap-2';
  const masked = `${secret.slice(0, 3)}…${secret.slice(-4)} (${secret.length} chars)`;
  const text = document.createElement('span');
  text.className = 'text-xs text-zinc-200 font-mono';
  text.textContent = masked;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'text-[11px] text-blue-400 hover:text-blue-300';
  toggle.textContent = 'Reveal';
  let revealed = false;
  toggle.addEventListener('click', () => {
    revealed = !revealed;
    text.textContent = revealed ? secret : masked;
    toggle.textContent = revealed ? 'Hide' : 'Reveal';
  });
  wrap.append(text, toggle);
  return wrap;
}

function summarizeValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (value instanceof Blob) return `Blob (${value.type || 'binary'}, ${formatBytes(value.size)})`;
  if (typeof value === 'string') {
    return value.length > 2000 ? `${value.slice(0, 2000)}… (${value.length} chars)` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const json = safeJson(value);
    return json.length > 2000 ? `Array(${value.length}) — ${json.slice(0, 2000)}…` : json;
  }
  const json = safeJson(value);
  return json.length > 2000 ? `${json.slice(0, 2000)}… (${json.length} chars)` : json;
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, (_k, val) => (val instanceof Blob ? `Blob(${val.size}b)` : val), 2);
  } catch {
    return String(v);
  }
}

function renderLocalStorage(): void {
  if (!rootEl) return;
  const list = document.createElement('div');
  list.className = 'flex flex-col gap-2';
  for (const entry of listLocalStorageEntries()) {
    const row = document.createElement('div');
    row.className = 'border border-zinc-800 rounded p-2 bg-zinc-800/30';
    const k = document.createElement('div');
    k.className = 'text-[11px] text-zinc-400 font-mono mb-1 flex justify-between';
    const keyName = document.createElement('span');
    keyName.textContent = entry.key;
    const size = document.createElement('span');
    size.className = 'text-zinc-600';
    size.textContent = formatBytes(entry.bytes);
    k.append(keyName, size);
    const v = document.createElement('pre');
    v.className = 'text-xs text-zinc-200 whitespace-pre-wrap break-words font-mono m-0';
    v.textContent = entry.value.length > 2000 ? `${entry.value.slice(0, 2000)}…` : entry.value;
    row.append(k, v);
    list.appendChild(row);
  }
  rootEl.appendChild(list);
}

function emptyLine(text: string): HTMLElement {
  const d = document.createElement('div');
  d.className = 'text-sm text-zinc-500';
  d.textContent = text;
  return d;
}

function errorLine(err: unknown): HTMLElement {
  const d = document.createElement('div');
  d.className = 'text-sm text-red-400';
  d.textContent = `Couldn't read data: ${err instanceof Error ? err.message : String(err)}`;
  return d;
}
