import { partwrightMarkSvg } from './brand';
import { getTheme, onThemeChange, toggleTheme } from './theme';
import { downloadBlob } from '../export/download';
import {
  listExports,
  clearExports,
  onExportInboxChange,
  type ExportInboxEntry,
} from '../export/exportInbox';
import {
  listImports,
  clearImports,
  onImportInboxChange,
  type ImportInboxEntry,
} from '../import/importInbox';

export interface ToolbarCallbacks {
  onRun: () => void;
  onExportGLB: () => void;
  onExportSTL: () => void;
  onExportOBJ: () => void;
  onExport3MF: () => void;
  /** Voxel-only — silently hidden from the menu unless the active language is
   *  'voxel' (gated at menu-open time, like {@link onExportSTEP}). */
  onExportVOX: () => void;
  /** BREP-only — silently hidden from the menu when the active language is
   *  not 'replicad'. Toolbar pings `getActiveLanguage` at menu-open time to
   *  decide visibility. */
  onExportSTEP: () => void;
  onExportSessionJSON: () => void;
  /** "Share link…" — encode the current version into a read-only,
   *  hash-encoded share URL and open the copy modal. */
  onShareLink: () => void;
  onExportRawCode: () => void;
  onImportFile: (file: File) => void | Promise<void>;
  /** Re-import a blob already held in the inbox (e.g. recent-imports re-click). */
  onImportInboxEntry: (entry: ImportInboxEntry) => void | Promise<void>;
  /** Open the image → keychain / tile / stepped-relief import wizard. */
  onCreateRelief: () => void;
  onLanguageSwitch: (lang: 'manifold-js' | 'scad' | 'replicad' | 'voxel') => void;
  /** "?" link next to the language toggle — opens a modal explaining
   *  what each engine is best for. */
  onLanguageHelp: () => void | Promise<void>;
  onGoHome: () => void;
  /** Toggle the AI chat drawer — drives the prominent "Use AI" button in the toolbar. */
  onToggleAi: () => void;
}

/** Update the unseen-error badge count on the diagnostics rail button.
 *  Called by diagnosticsPanel when new entries arrive while the panel is closed.
 *  The badge (id `diag-badge`) lives in the activity rail — see createLayout. */
export function setDiagnosticsToolbarBadge(count: number): void {
  const badge = document.getElementById('diag-badge');
  if (!badge) return;
  if (count === 0) {
    badge.classList.add('hidden');
  } else {
    badge.classList.remove('hidden');
    badge.textContent = count > 99 ? '99+' : String(count);
  }
}

export type AiToolbarMode = 'disconnected' | 'cloud' | 'local';

/** Update the AI chip label/state from outside. Cloud = Anthropic key is
 *  connected; Local = a local WebGPU model is configured; Disconnected =
 *  neither, so clicking opens the connect flow. */
export function setAiToolbarState(mode: AiToolbarMode | boolean): void {
  // Two entry points share the same status: the activity-rail item (id
  // `btn-ai`, label "AI") and the prominent toolbar button (id
  // `btn-ai-toolbar`, label "Use AI"). Each has its own status-dot span; we
  // sync title + dot colour on both so they always agree.
  const railDot = document.getElementById('ai-status-dot');
  const railBtn = document.getElementById('btn-ai');
  const toolbarDot = document.getElementById('ai-toolbar-status-dot');
  const toolbarBtn = document.getElementById('btn-ai-toolbar');
  // Tolerate the legacy boolean caller signature so an old import doesn't
  // crash at runtime.
  const actual: AiToolbarMode = typeof mode === 'boolean' ? (mode ? 'cloud' : 'disconnected') : mode;
  const base = 'w-1.5 h-1.5 rounded-full shrink-0 ';
  let dotClass: string;
  let title: string;
  if (actual === 'cloud') {
    dotClass = base + 'bg-blue-400';
    title = 'AI chat — hosted Claude connected. Click to open.';
  } else if (actual === 'local') {
    dotClass = base + 'bg-emerald-400';
    title = 'AI chat — local WebGPU model. Click to open.';
  } else {
    dotClass = base + 'bg-zinc-500';
    title = 'AI chat — not connected. Click to connect an API key or local model.';
  }
  if (railDot) railDot.className = dotClass;
  if (railBtn) railBtn.title = title;
  if (toolbarDot) toolbarDot.className = dotClass;
  if (toolbarBtn) toolbarBtn.title = title;
}

/** File extensions accepted by the Import button and drag-and-drop. */
export const IMPORT_ACCEPT = '.partwright.json,.json,.js,.scad,.stl,.step,.stp,.vox,.png,.jpg,.jpeg,.gif,.webp,.bmp';
/** Raster image types accepted by the dedicated "Image → voxel" picker. */
export const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.bmp';

let _autoRun = true;
let _onAutoRunChange: ((on: boolean) => void) | null = null;
let _syncAutoRunUI: (() => void) | null = null;

/** Whether auto-run on edit is enabled */
export function isAutoRun(): boolean { return _autoRun; }

/** Programmatically set auto-run state (also syncs the toolbar button UI) */
export function setAutoRun(enabled: boolean): void {
  if (_autoRun === enabled) return;
  _autoRun = enabled;
  _syncAutoRunUI?.();
  if (_onAutoRunChange) _onAutoRunChange(_autoRun);
}

/** Register a callback for when auto-run state changes */
export function onAutoRunChange(cb: (on: boolean) => void): void { _onAutoRunChange = cb; }

// Language toggle state — managed externally via setToolbarLanguage()
let _langBtnJs: HTMLButtonElement | null = null;
let _langBtnScad: HTMLButtonElement | null = null;
let _langBtnBrep: HTMLButtonElement | null = null;
let _langBtnVoxel: HTMLButtonElement | null = null;
let _currentLang: 'manifold-js' | 'scad' | 'replicad' | 'voxel' = 'manifold-js';

const LANG_ACTIVE = 'px-2 py-0.5 rounded text-xs font-medium transition-colors bg-zinc-700 text-zinc-100';
const LANG_INACTIVE = 'px-2 py-0.5 rounded text-xs font-medium transition-colors text-zinc-500 hover:text-zinc-300';

function syncLangToggle() {
  if (!_langBtnJs || !_langBtnScad || !_langBtnBrep || !_langBtnVoxel) return;
  _langBtnJs.className = _currentLang === 'manifold-js' ? LANG_ACTIVE : LANG_INACTIVE;
  _langBtnScad.className = _currentLang === 'scad' ? LANG_ACTIVE : LANG_INACTIVE;
  _langBtnBrep.className = _currentLang === 'replicad' ? LANG_ACTIVE : LANG_INACTIVE;
  _langBtnVoxel.className = _currentLang === 'voxel' ? LANG_ACTIVE : LANG_INACTIVE;
}

/** Update the toolbar language toggle from outside (e.g. when opening a session). */
export function setToolbarLanguage(lang: 'manifold-js' | 'scad' | 'replicad' | 'voxel'): void {
  _currentLang = lang;
  syncLangToggle();
}

export function createToolbar(
  container: HTMLElement,
  callbacks: ToolbarCallbacks,
): HTMLElement {
  const toolbar = document.createElement('div');
  toolbar.className = 'flex flex-wrap md:flex-nowrap items-center gap-1 px-3 py-1.5 bg-zinc-900 border-b border-zinc-700 text-sm shrink-0';

  // Logo — clicking returns to the landing page
  const logo = document.createElement('button');
  logo.type = 'button';
  logo.className = 'flex items-center gap-2 mr-4 bg-transparent border-0 p-0 cursor-pointer hover:opacity-80 transition-opacity';
  logo.title = 'Back to home';
  logo.setAttribute('aria-label', 'Partwright home');
  logo.innerHTML = `${partwrightMarkSvg(20)}<span class="text-zinc-100 font-semibold tracking-tight">Partwright</span>`;
  logo.addEventListener('click', callbacks.onGoHome);
  toolbar.appendChild(logo);

  // Auto-run toggle + manual Run button
  const runGroup = document.createElement('div');
  runGroup.className = 'flex items-center gap-1';

  const autoRunBtn = document.createElement('button');
  autoRunBtn.id = 'btn-auto-run';
  autoRunBtn.title = 'Auto-render is ON — code re-renders as you type. Click to pause.';

  const btnRun = createButton('btn-run', '\u25B6 Run');
  btnRun.addEventListener('click', callbacks.onRun);
  btnRun.classList.add('hidden');

  function syncAutoRunUI() {
    if (_autoRun) {
      autoRunBtn.className = 'flex items-center gap-1 px-2 py-1 rounded text-xs text-emerald-400 hover:bg-zinc-700 transition-colors';
      autoRunBtn.textContent = '\u23F8 Auto';
      autoRunBtn.title = 'Auto-render is ON \u2014 code re-renders as you type. Click to pause.';
      btnRun.classList.add('hidden');
    } else {
      autoRunBtn.className = 'flex items-center gap-1 px-2 py-1 rounded text-xs text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300 transition-colors';
      autoRunBtn.textContent = '\u25B6 Auto';
      autoRunBtn.title = 'Auto-render is OFF \u2014 click to resume, or use the Run button.';
      btnRun.classList.remove('hidden');
    }
  }
  _syncAutoRunUI = syncAutoRunUI;

  autoRunBtn.addEventListener('click', () => {
    _autoRun = !_autoRun;
    syncAutoRunUI();
    if (_onAutoRunChange) _onAutoRunChange(_autoRun);
    // If re-enabling auto-run, trigger an immediate render
    if (_autoRun) callbacks.onRun();
  });

  syncAutoRunUI();
  runGroup.appendChild(autoRunBtn);
  runGroup.appendChild(btnRun);
  toolbar.appendChild(runGroup);

  // Language toggle — segmented JS / SCAD control
  const langGroup = document.createElement('div');
  langGroup.id = 'lang-toggle';
  langGroup.className = 'flex items-center bg-zinc-800 border border-zinc-600 rounded ml-2';
  langGroup.title = 'Modeling language';

  _langBtnJs = document.createElement('button');
  _langBtnJs.textContent = 'JS';
  _langBtnJs.addEventListener('click', () => {
    if (_currentLang !== 'manifold-js') {
      callbacks.onLanguageSwitch('manifold-js');
    }
  });

  _langBtnScad = document.createElement('button');
  _langBtnScad.textContent = 'SCAD';
  _langBtnScad.addEventListener('click', () => {
    if (_currentLang !== 'scad') {
      callbacks.onLanguageSwitch('scad');
    }
  });

  _langBtnBrep = document.createElement('button');
  _langBtnBrep.textContent = 'BREP';
  _langBtnBrep.title = 'BREP (replicad / OpenCASCADE) — exact fillets, chamfers, STEP export. Lazy-loads on first switch.';
  _langBtnBrep.addEventListener('click', () => {
    if (_currentLang !== 'replicad') {
      callbacks.onLanguageSwitch('replicad');
    }
  });

  _langBtnVoxel = document.createElement('button');
  _langBtnVoxel.textContent = 'VOXEL';
  _langBtnVoxel.title = 'Voxel — blocky colored-cube modeling. Pure JS, no WASM; great for pixel-art and image imports.';
  _langBtnVoxel.addEventListener('click', () => {
    if (_currentLang !== 'voxel') {
      callbacks.onLanguageSwitch('voxel');
    }
  });

  syncLangToggle();
  langGroup.appendChild(_langBtnJs);
  langGroup.appendChild(_langBtnScad);
  langGroup.appendChild(_langBtnBrep);
  langGroup.appendChild(_langBtnVoxel);
  toolbar.appendChild(langGroup);

  // Help link next to the language toggle — "?" icon that opens a modal
  // explaining what each engine is best for. Small footprint so it doesn't
  // crowd the toolbar; the title attribute also reads as a hint if the user
  // hovers without clicking.
  const langHelpBtn = document.createElement('button');
  langHelpBtn.type = 'button';
  langHelpBtn.className = 'ml-1 w-5 h-5 rounded-full text-[10px] font-bold text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 border border-zinc-600 flex items-center justify-center transition-colors';
  langHelpBtn.textContent = '?';
  langHelpBtn.title = 'What language to pick?';
  langHelpBtn.setAttribute('aria-label', 'Open language help');
  langHelpBtn.addEventListener('click', () => { void callbacks.onLanguageHelp(); });
  toolbar.appendChild(langHelpBtn);

  // Spacer
  const spacer = document.createElement('div');
  spacer.className = 'flex-1';
  toolbar.appendChild(spacer);

  // Use AI — primary entry point to the chat drawer. The activity rail also
  // has a "✦ AI" item, but on mobile it lives in a horizontally-scrollable
  // strip and is easy to miss; this toolbar button is always visible and
  // styled with an indigo accent so it catches the eye while still fitting
  // the zinc toolbar palette. Id is `btn-ai-toolbar` to avoid colliding with
  // the rail's existing `#btn-ai` (which tests and the tour both reference).
  const aiToolbarBtn = document.createElement('button');
  aiToolbarBtn.id = 'btn-ai-toolbar';
  const aiBase = 'flex items-center gap-1.5 px-3 py-1.5 md:px-2.5 md:py-1 rounded text-xs font-semibold transition-colors border ml-2';
  const aiIdle = `${aiBase} bg-indigo-500/15 border-indigo-500/40 text-indigo-200 [@media(hover:hover)]:hover:bg-indigo-500/25 [@media(hover:hover)]:hover:text-indigo-100`;
  const aiOpen = `${aiBase} bg-indigo-500/30 border-indigo-500/70 text-indigo-50 [@media(hover:hover)]:hover:bg-indigo-500/35`;
  aiToolbarBtn.className = aiIdle;
  aiToolbarBtn.title = 'AI chat — not connected. Click to connect an API key or local model.';
  aiToolbarBtn.setAttribute('aria-label', 'Open AI chat panel');
  aiToolbarBtn.innerHTML = '<span id="ai-toolbar-status-dot" class="w-1.5 h-1.5 rounded-full shrink-0 bg-zinc-500"></span><span class="text-sm leading-none" aria-hidden="true">✦</span><span>Use AI</span>';
  aiToolbarBtn.addEventListener('click', callbacks.onToggleAi);
  window.addEventListener('ai-panel-toggled', (e) => {
    const open = !!(e as CustomEvent).detail?.open;
    aiToolbarBtn.className = open ? aiOpen : aiIdle;
    aiToolbarBtn.setAttribute('aria-pressed', String(open));
  });
  toolbar.appendChild(aiToolbarBtn);

  // Catalog — navigates to /catalog where premade sessions are browsed.
  // (Catalog moved to the activity rail's utility group \u2014 see createLayout.)

  // Import dropdown — mirrors the Export dropdown. Holds a "Choose file…" entry
  // (the existing OS file picker) and a "Recent Imports" section for re-import.
  const importWrapper = document.createElement('div');
  importWrapper.className = 'relative ml-2';
  importWrapper.id = 'import-wrapper';

  const btnImport = createButton('btn-import', '\u2191 Import');
  btnImport.title = 'Import a .partwright.json session, a .js / .scad source file, or an .stl mesh';
  importWrapper.appendChild(btnImport);

  // Hidden file input — kept inside the wrapper so click-outside-to-close still works.
  const importInput = document.createElement('input');
  importInput.type = 'file';
  importInput.accept = IMPORT_ACCEPT;
  importInput.className = 'hidden';
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    if (file) await callbacks.onImportFile(file);
    importInput.value = '';
  });
  importWrapper.appendChild(importInput);

  const importDropdown = document.createElement('div');
  importDropdown.id = 'import-dropdown';
  importDropdown.className = 'fixed left-2 right-2 top-14 bg-zinc-800 border border-zinc-600 rounded shadow-lg py-1 hidden z-20 max-h-[80vh] overflow-y-auto md:absolute md:left-auto md:right-0 md:top-full md:mt-1 md:w-72';

  importDropdown.appendChild(createSectionHeader('From file'));
  const chooseFileOpt = createDescribedItem(
    'Choose file\u2026',
    'Open a .partwright.json session, a .js / .scad source file, or an .stl mesh.',
  );
  chooseFileOpt.addEventListener('click', () => {
    importDropdown.classList.add('hidden');
    importInput.accept = IMPORT_ACCEPT; // restore the full filter (the image row narrows it)
    importInput.click();
  });
  importDropdown.appendChild(chooseFileOpt);

  importDropdown.appendChild(createDivider());
  importDropdown.appendChild(createSectionHeader('Create'));
  const reliefOpt = createDescribedItem(
    'Image → keychain / tile / relief…',
    'Turn an image (or SVG) into a printable colour tile, keychain, sticker, or stepped relief.',
  );
  reliefOpt.addEventListener('click', () => {
    importDropdown.classList.add('hidden');
    callbacks.onCreateRelief();
  });
  importDropdown.appendChild(reliefOpt);

  const imageVoxelOpt = createDescribedItem(
    'Image → voxel…',
    'Turn an image into a colored voxel model — flat billboard or brightness-driven relief — with adjustable resolution, depth, and color.',
  );
  imageVoxelOpt.addEventListener('click', () => {
    importDropdown.classList.add('hidden');
    // Reuse the single import file input (a second one would break the
    // `#import-wrapper input[type=file]` selector other tests rely on), just
    // narrowed to raster images for this row. The change handler routes the
    // picked image into the voxel-import modal via onImportFile.
    importInput.accept = IMAGE_ACCEPT;
    importInput.click();
  });
  importDropdown.appendChild(imageVoxelOpt);

  // Recent Imports section — populated from the import inbox.
  const importRecentDivider = createDivider();
  const importRecentHeaderRow = document.createElement('div');
  importRecentHeaderRow.className = 'flex items-center justify-between px-3 pt-1 pb-0.5';
  const importRecentHeader = document.createElement('div');
  importRecentHeader.className = 'text-[10px] uppercase tracking-wider text-zinc-500 font-semibold';
  importRecentHeader.textContent = 'Recent Imports';
  const importClearBtn = document.createElement('button');
  importClearBtn.className = 'text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors';
  importClearBtn.textContent = 'Clear';
  importClearBtn.title = 'Clear recent imports list';
  importClearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearImports();
  });
  importRecentHeaderRow.appendChild(importRecentHeader);
  importRecentHeaderRow.appendChild(importClearBtn);

  const importRecentList = document.createElement('div');
  importRecentList.id = 'import-recent-list';

  function renderImportRecent() {
    const entries = listImports();
    const hasEntries = entries.length > 0;
    importRecentDivider.classList.toggle('hidden', !hasEntries);
    importRecentHeaderRow.classList.toggle('hidden', !hasEntries);
    importRecentList.classList.toggle('hidden', !hasEntries);
    importRecentList.replaceChildren(...entries.map(renderImportRecentItem));
  }

  function renderImportRecentItem(entry: ImportInboxEntry): HTMLElement {
    const btn = document.createElement('button');
    btn.className = 'flex items-center gap-2 w-full text-left px-3 py-1 hover:bg-zinc-700 transition-colors';
    btn.title = `Re-import ${entry.filename}`;

    // Thumbnail (image/SVG imports only); a checkered backdrop reads through
    // transparent PNGs so a logo's shape is still legible.
    if (entry.thumbnail) {
      const thumb = document.createElement('img');
      thumb.src = entry.thumbnail;
      thumb.alt = '';
      thumb.className = 'w-8 h-8 rounded border border-zinc-600 object-contain shrink-0 bg-zinc-900';
      btn.appendChild(thumb);
    }

    const textCol = document.createElement('div');
    textCol.className = 'min-w-0 flex-1';

    const top = document.createElement('div');
    top.className = 'flex items-center gap-1.5';

    const sourceBadge = document.createElement('span');
    sourceBadge.className = 'text-[9px] uppercase tracking-wide text-zinc-400 border border-zinc-600 rounded px-1 py-px shrink-0';
    // Tag voxel image imports distinctly from relief ones in the badge.
    const meta = entry.metadata as { importer?: string } | undefined;
    sourceBadge.textContent = meta?.importer === 'voxel' ? 'VOXEL'
      : meta?.importer === 'relief' ? 'RELIEF'
      : entry.source;
    top.appendChild(sourceBadge);

    const nameEl = document.createElement('span');
    nameEl.className = 'text-xs text-zinc-200 truncate';
    nameEl.textContent = entry.filename;
    top.appendChild(nameEl);

    textCol.appendChild(top);

    const metaEl = document.createElement('div');
    metaEl.className = 'text-[10px] text-zinc-500 leading-tight mt-0.5';
    metaEl.textContent = `${formatSize(entry.sizeBytes)} • ${formatRelativeTime(entry.timestamp)}`;
    textCol.appendChild(metaEl);

    btn.appendChild(textCol);

    btn.addEventListener('click', () => {
      importDropdown.classList.add('hidden');
      void callbacks.onImportInboxEntry(entry);
    });

    return btn;
  }

  importDropdown.appendChild(importRecentDivider);
  importDropdown.appendChild(importRecentHeaderRow);
  importDropdown.appendChild(importRecentList);
  renderImportRecent();
  onImportInboxChange(renderImportRecent);

  importWrapper.appendChild(importDropdown);

  btnImport.addEventListener('click', () => {
    renderImportRecent();
    importDropdown.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!importWrapper.contains(e.target as Node)) {
      importDropdown.classList.add('hidden');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !importDropdown.classList.contains('hidden')) {
      importDropdown.classList.add('hidden');
    }
  });

  toolbar.appendChild(importWrapper);

  // Export dropdown
  const exportWrapper = document.createElement('div');
  exportWrapper.className = 'relative ml-1';
  exportWrapper.id = 'export-wrapper';

  const btnExport = createButton('btn-export', '\u2193 Export');
  exportWrapper.appendChild(btnExport);

  const dropdown = document.createElement('div');
  dropdown.id = 'export-dropdown';
  dropdown.className = 'fixed left-2 right-2 top-14 bg-zinc-800 border border-zinc-600 rounded shadow-lg py-1 hidden z-20 max-h-[80vh] overflow-y-auto md:absolute md:left-auto md:right-0 md:top-full md:mt-1 md:w-72';

  // Section: 3D model formats
  dropdown.appendChild(createSectionHeader('3D model'));

  const threemfOpt = createDescribedItem(
    '3MF',
    'Geometry + color. Native format for Bambu Studio multi-color prints.',
    'Recommended',
  );
  threemfOpt.addEventListener('click', () => {
    dropdown.classList.add('hidden');
    callbacks.onExport3MF();
  });

  const objOpt = createDescribedItem(
    'OBJ',
    'Geometry + color via MTL. Extract ZIP before importing into slicer.',
  );
  objOpt.addEventListener('click', () => {
    dropdown.classList.add('hidden');
    callbacks.onExportOBJ();
  });

  const stlOpt = createDescribedItem(
    'STL',
    'Geometry only, no color. Universal slicer support.',
  );
  stlOpt.addEventListener('click', () => {
    dropdown.classList.add('hidden');
    callbacks.onExportSTL();
  });

  const glbOpt = createDescribedItem(
    'GLB',
    'Web/preview format with vertex colors. Not supported by slicers.',
  );
  glbOpt.addEventListener('click', () => {
    dropdown.classList.add('hidden');
    callbacks.onExportGLB();
  });

  // STEP — BREP-only; the menu show/hide is gated below in the open-menu
  // handler so the option only appears in 'replicad' sessions where there's
  // an actual BREP shape on the heap. (In manifold-js sessions with
  // `api.BREP.*` mixed in, the BREP source is forgotten at toManifold time —
  // STEP wouldn't have anything to export.)
  const stepOpt = createDescribedItem(
    'STEP',
    'Exact B-rep for mechanical-CAD interop (SolidWorks, Fusion, FreeCAD). BREP sessions only.',
  );
  stepOpt.addEventListener('click', () => {
    dropdown.classList.add('hidden');
    callbacks.onExportSTEP();
  });

  // VOX — voxel-only; gated in the open-menu handler like STEP. Round-trips
  // through our .vox importer and opens in MagicaVoxel / Goxel.
  const voxOpt = createDescribedItem(
    'VOX',
    'MagicaVoxel voxel grid — palette + cells, opens in MagicaVoxel / Goxel. Voxel sessions only.',
  );
  voxOpt.addEventListener('click', () => {
    dropdown.classList.add('hidden');
    callbacks.onExportVOX();
  });

  dropdown.appendChild(threemfOpt);
  dropdown.appendChild(objOpt);
  dropdown.appendChild(stlOpt);
  dropdown.appendChild(glbOpt);
  dropdown.appendChild(stepOpt);
  dropdown.appendChild(voxOpt);

  // Section: project / source — for sharing between users or working with the code directly
  dropdown.appendChild(createDivider());
  dropdown.appendChild(createSectionHeader('Project'));

  const sessionOpt = createDescribedItem(
    'Session (.partwright.json)',
    'All versions, notes, and attached images. Another Partwright user can import this.',
  );
  sessionOpt.addEventListener('click', () => {
    dropdown.classList.add('hidden');
    callbacks.onExportSessionJSON();
  });

  const codeOpt = createDescribedItem(
    'Code (raw)',
    'Just the editor source as plain .js or .scad text.',
  );
  codeOpt.addEventListener('click', () => {
    dropdown.classList.add('hidden');
    callbacks.onExportRawCode();
  });

  const shareOpt = createDescribedItem(
    'Share link…',
    'Create a public read-only link to this version. Anyone can preview and fork it — nothing is uploaded.',
  );
  shareOpt.addEventListener('click', () => {
    dropdown.classList.add('hidden');
    callbacks.onShareLink();
  });

  dropdown.appendChild(sessionOpt);
  dropdown.appendChild(codeOpt);
  dropdown.appendChild(shareOpt);

  // Section: Recent Exports — reuse-anything-you-just-downloaded list. Hidden when empty.
  const recentDivider = createDivider();
  const recentHeaderRow = document.createElement('div');
  recentHeaderRow.className = 'flex items-center justify-between px-3 pt-1 pb-0.5';
  const recentHeader = document.createElement('div');
  recentHeader.className = 'text-[10px] uppercase tracking-wider text-zinc-500 font-semibold';
  recentHeader.textContent = 'Recent Exports';
  const clearBtn = document.createElement('button');
  clearBtn.className = 'text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors';
  clearBtn.textContent = 'Clear';
  clearBtn.title = 'Clear recent exports list';
  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearExports();
  });
  recentHeaderRow.appendChild(recentHeader);
  recentHeaderRow.appendChild(clearBtn);

  const recentList = document.createElement('div');
  recentList.id = 'export-recent-list';

  function renderRecent() {
    const entries = listExports();
    const hasEntries = entries.length > 0;
    recentDivider.classList.toggle('hidden', !hasEntries);
    recentHeaderRow.classList.toggle('hidden', !hasEntries);
    recentList.classList.toggle('hidden', !hasEntries);
    recentList.replaceChildren(...entries.map(renderRecentItem));
  }

  function renderRecentItem(entry: ExportInboxEntry): HTMLElement {
    const btn = document.createElement('button');
    btn.className = 'block w-full text-left px-3 py-1 hover:bg-zinc-700 transition-colors';
    btn.title = `Download ${entry.filename} again`;

    const top = document.createElement('div');
    top.className = 'flex items-center gap-1.5';

    const sourceBadge = document.createElement('span');
    sourceBadge.className = 'text-[9px] uppercase tracking-wide text-zinc-400 border border-zinc-600 rounded px-1 py-px shrink-0';
    sourceBadge.textContent = entry.source;
    top.appendChild(sourceBadge);

    const nameEl = document.createElement('span');
    nameEl.className = 'text-xs text-zinc-200 truncate';
    nameEl.textContent = entry.filename;
    top.appendChild(nameEl);

    btn.appendChild(top);

    const meta = document.createElement('div');
    meta.className = 'text-[10px] text-zinc-500 leading-tight mt-0.5';
    meta.textContent = `${formatSize(entry.sizeBytes)} • ${formatRelativeTime(entry.timestamp)}`;
    btn.appendChild(meta);

    btn.addEventListener('click', () => {
      dropdown.classList.add('hidden');
      // Re-download the existing blob; don't re-register (avoid duplicate entries).
      downloadBlob(entry.blob, entry.filename, entry.source, { register: false });
    });

    return btn;
  }

  dropdown.appendChild(recentDivider);
  dropdown.appendChild(recentHeaderRow);
  dropdown.appendChild(recentList);
  renderRecent();
  onExportInboxChange(renderRecent);

  exportWrapper.appendChild(dropdown);

  btnExport.addEventListener('click', () => {
    // Refresh relative timestamps each time the dropdown opens.
    renderRecent();
    // STEP is BREP-only and VOX is voxel-only — show/hide based on the language
    // toggle's current state. Putting this on open (rather than wiring a setter)
    // keeps the menu logic local; a language switch closes the menu first anyway.
    stepOpt.classList.toggle('hidden', _currentLang !== 'replicad');
    voxOpt.classList.toggle('hidden', _currentLang !== 'voxel');
    dropdown.classList.toggle('hidden');
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!exportWrapper.contains(e.target as Node)) {
      dropdown.classList.add('hidden');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dropdown.classList.contains('hidden')) {
      dropdown.classList.add('hidden');
    }
  });

  toolbar.appendChild(exportWrapper);

  // Dark mode toggle — text button, on by default, off when clicked
  const themeBtn = document.createElement('button');
  themeBtn.id = 'btn-theme';
  themeBtn.textContent = 'Dark Mode';
  const themeActive = 'px-2 py-0.5 rounded text-xs font-medium transition-colors bg-zinc-700 text-zinc-100 ml-2';
  const themeInactive = 'px-2 py-0.5 rounded text-xs font-medium transition-colors text-zinc-500 hover:text-zinc-300 border border-zinc-600 ml-2';
  const syncThemeBtn = (theme: 'light' | 'dark') => {
    const on = theme === 'dark';
    themeBtn.className = on ? themeActive : themeInactive;
    themeBtn.title = on ? 'Dark mode on — click to switch to light' : 'Dark mode off — click to switch to dark';
    themeBtn.setAttribute('aria-pressed', String(on));
    themeBtn.setAttribute('aria-label', themeBtn.title);
  };
  syncThemeBtn(getTheme());
  themeBtn.addEventListener('click', () => { toggleTheme(); });
  onThemeChange(syncThemeBtn);
  toolbar.appendChild(themeBtn);

  // Quality settings, Diagnostics, and Help moved to the activity rail's utility
  // group — see createLayout. The tour is reachable from the ⌘K palette.

  container.appendChild(toolbar);

  return toolbar;
}

function createButton(id: string, text: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.id = id;
  btn.className = 'flex items-center gap-1.5 px-3 py-2 md:px-2.5 md:py-1 rounded text-zinc-300 [@media(hover:hover)]:hover:bg-zinc-700 [@media(hover:hover)]:hover:text-zinc-100 transition-colors text-sm md:text-xs';
  btn.textContent = text;
  return btn;
}

function createDescribedItem(label: string, description: string, badge?: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'block w-full text-left px-3 py-1.5 hover:bg-zinc-700 transition-colors';

  const top = document.createElement('div');
  top.className = 'flex items-center gap-1.5';

  const labelEl = document.createElement('span');
  labelEl.className = 'text-xs text-zinc-200 font-medium';
  labelEl.textContent = label;
  top.appendChild(labelEl);

  if (badge) {
    const badgeEl = document.createElement('span');
    badgeEl.className = 'text-[9px] uppercase tracking-wide text-emerald-400 border border-emerald-400/30 rounded px-1 py-px';
    badgeEl.textContent = badge;
    top.appendChild(badgeEl);
  }

  btn.appendChild(top);

  const descEl = document.createElement('div');
  descEl.className = 'text-[10px] text-zinc-500 leading-tight mt-0.5';
  descEl.textContent = description;
  btn.appendChild(descEl);

  return btn;
}

function createSectionHeader(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'px-3 pt-1 pb-0.5 text-[10px] uppercase tracking-wider text-zinc-500 font-semibold';
  el.textContent = text;
  return el;
}

function createDivider(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'my-1 border-t border-zinc-700';
  return el;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
