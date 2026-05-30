import { getMobilePane, onMobilePaneChange, setMobilePane } from './mobilePane';
import { showQualitySettingsModal } from './qualitySettingsModal';
import { showAboutModal } from './aboutModal';
import { loadSettings, saveSettings } from '../ai/settings';

export type TabName = 'interactive' | 'gallery' | 'versions' | 'images' | 'diff' | 'notes' | 'data';

export interface LayoutElements {
  editorPane: HTMLElement;
  partsRail: HTMLElement;
  editorContainer: HTMLElement;
  editorErrorPanel: HTMLElement;
  viewportPane: HTMLElement;
  galleryContainer: HTMLElement;
  versionsContainer: HTMLElement;
  imagesContainer: HTMLElement;
  diffContainer: HTMLElement;
  notesContainer: HTMLElement;
  dataContainer: HTMLElement;
  statusBar: HTMLElement;
  clipControls: HTMLElement;
  formatBtn: HTMLButtonElement;
  autoFormatToggle: HTMLButtonElement;
  switchTab: (tab: TabName, options?: SwitchTabOptions) => void;
  /** Collapse/expand the parts rail (wired to the rail's own collapse button). */
  togglePartsRail: () => void;
  /** Collapse the code editor pane (used by focus modes like Relief Studio). */
  collapseEditor: () => void;
  /** Restore the code editor pane after a collapse. */
  expandEditor: () => void;
}

export interface SwitchTabOptions {
  history?: 'push' | 'replace' | 'none';
}

export interface CreateLayoutOptions {
  /** Toggle the AI chat drawer — wired to the AI item in the activity rail. */
  onToggleAi?: () => void;
  /** Navigate to the catalog page (rail utility item). */
  onOpenCatalog?: () => void;
  /** Toggle the diagnostic log panel (rail utility item). */
  onToggleDiagnostics?: () => void;
  /** Open the session switcher list (rail header action). */
  onOpenSessionList?: () => void;
  /** Launch the first-visit guided tour (rail utility item). */
  onStartTour?: () => void;
}

export function createLayout(appContainer: HTMLElement, opts: CreateLayoutOptions = {}): LayoutElements {
  const main = document.createElement('div');
  // Stack panes vertically on narrow viewports, side-by-side at md+.
  main.className = 'flex flex-col md:flex-row flex-1 min-h-0';

  // === Left (or top on mobile): Editor group = parts rail + editor pane ===
  // The GROUP is the width-managed, resizable unit — the splitter and the
  // collapse/expand logic act on it, and on mobile it stacks above the viewport
  // as one block. Width is only applied via inline style at md+; on mobile the
  // group uses flex sizing so it shares the vertical space with the viewport.
  const editorGroup = document.createElement('div');
  editorGroup.className = 'relative flex flex-row flex-1 md:flex-none min-h-0 border-b md:border-b-0 md:border-r border-zinc-700';

  // Parts rail — IDE-style list of the session's parts (create / select /
  // rename / delete / drag-reorder). Populated by createPartList() in main.ts.
  const partsRail = document.createElement('div');
  partsRail.id = 'parts-rail';
  partsRail.className = 'flex flex-col shrink-0 w-36 md:w-48 min-h-0 border-r border-zinc-700 bg-zinc-900/60 overflow-hidden';

  // The editor pane itself sits to the right of the rail and fills the rest.
  // `relative` so the absolutely-positioned error-panel overlay anchors here.
  const editorPane = document.createElement('div');
  editorPane.className = 'relative flex flex-col flex-1 min-w-0 min-h-0';

  const editorHeader = document.createElement('div');
  editorHeader.className = 'flex items-center px-3 py-1.5 bg-zinc-800 border-b border-zinc-700 gap-2';

  const editorTitle = document.createElement('span');
  editorTitle.id = 'editor-title';
  // truncate + min-w-0 so a long part name ellipsizes instead of pushing the
  // status indicator and buttons out of the (now rail-narrowed) header.
  editorTitle.className = 'text-xs text-zinc-400 font-mono truncate min-w-0';
  editorTitle.textContent = 'editor.js';
  editorHeader.appendChild(editorTitle);

  const editorHeaderSpacer = document.createElement('div');
  editorHeaderSpacer.className = 'flex-1';
  editorHeader.appendChild(editorHeaderSpacer);

  const formatBtn = document.createElement('button');
  formatBtn.id = 'format-btn';
  formatBtn.className = 'shrink-0 px-2 py-0.5 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 text-xs leading-none border border-transparent hover:border-zinc-600';
  formatBtn.textContent = 'Format';
  formatBtn.title = 'Format code (Shift+Alt+F)';
  editorHeader.appendChild(formatBtn);

  const autoFormatToggle = document.createElement('button');
  autoFormatToggle.id = 'auto-format-toggle';
  autoFormatToggle.className = 'shrink-0 px-2 py-0.5 rounded text-xs leading-none border';
  autoFormatToggle.title = 'Toggle automatic formatting when code is loaded';
  editorHeader.appendChild(autoFormatToggle);

  const statusBar = document.createElement('span');
  statusBar.id = 'status-indicator';
  // Lives on rightPane (appended below) as an always-visible overlay so engine
  // status stays on screen even when the code pane is collapsed — otherwise
  // tests and users lose the Ready/Loading signal whenever the AI drawer hides
  // the editor header.
  statusBar.className = 'absolute top-2 left-2 z-20 text-xs text-emerald-400 font-mono bg-zinc-900/70 px-2 py-0.5 rounded border border-zinc-700 pointer-events-none';
  statusBar.textContent = 'Ready';

  const collapseEditorBtn = document.createElement('button');
  collapseEditorBtn.className = 'shrink-0 px-2 py-0.5 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 text-xs leading-none border border-transparent hover:border-zinc-600';
  collapseEditorBtn.textContent = 'Hide code';
  collapseEditorBtn.title = 'Hide the code editor pane';
  editorHeader.appendChild(collapseEditorBtn);

  editorPane.appendChild(editorHeader);

  // Overlay (absolutely positioned) so showing/hiding it never reflows the code
  // or moves the caret. Anchored to the bottom of the editor pane; long errors
  // scroll within it.
  const editorErrorPanel = document.createElement('div');
  editorErrorPanel.id = 'editor-error-panel';
  editorErrorPanel.className = 'hidden absolute bottom-0 left-0 right-0 z-10 max-h-[45%] overflow-auto border-t border-red-500/40 bg-red-950/90 backdrop-blur-sm px-3 py-2 text-xs text-red-100 shadow-lg';
  editorPane.appendChild(editorErrorPanel);

  const editorContainer = document.createElement('div');
  editorContainer.id = 'editor-container';
  editorContainer.className = 'flex-1 min-h-0 overflow-hidden';
  editorPane.appendChild(editorContainer);

  // === Splitter ===
  // Outer is a wide transparent grab strip (touch-friendly); inner stripe is the
  // 1px visible line. `touch-none` blocks the browser from claiming the gesture
  // for scrolling so pointer drag works on touch devices.
  const splitter = document.createElement('div');
  splitter.className = 'hidden md:flex relative items-stretch w-2 bg-transparent cursor-col-resize shrink-0 touch-none group';
  const splitterStripe = document.createElement('div');
  splitterStripe.className = 'absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-zinc-700 group-hover:bg-blue-500 group-[.is-dragging]:bg-blue-500 transition-colors';
  splitter.appendChild(splitterStripe);
  initSplitter(splitter, editorGroup);

  // === Activity rail: labeled navigation spine ===
  // Replaces the old cryptic top tab strip. Vertical on desktop (a left rail),
  // a horizontally-scrollable strip on mobile. Each item drives switchTab and
  // keeps its canonical `data-tab` value so tests, the guided tour, and deep
  // links keep working unchanged.
  const rail = document.createElement('div');
  rail.id = 'activity-rail';
  rail.className = 'flex md:flex-col shrink-0 w-full md:w-52 overflow-x-auto md:overflow-x-visible md:overflow-y-hidden bg-zinc-900/60 border-b md:border-b-0 md:border-r border-zinc-700 [scrollbar-width:thin]';

  // Session switcher — the cross-session "level up" action, pinned to the very
  // top of the rail above the per-session destinations (the session's name and
  // version controls stay in the session bar).
  const sessionsBtn = document.createElement('button');
  sessionsBtn.id = 'btn-sessions';
  sessionsBtn.className = 'flex items-center gap-2 shrink-0 whitespace-nowrap px-3 py-2.5 md:py-2 text-sm md:text-[13px] font-medium text-zinc-200 border-b-2 md:border-b border-transparent md:border-zinc-800 [@media(hover:hover)]:hover:text-zinc-100 [@media(hover:hover)]:hover:bg-zinc-800/60 transition-colors';
  sessionsBtn.title = 'Switch or manage sessions';
  sessionsBtn.innerHTML = '<span class="text-base leading-none w-5 text-center" aria-hidden="true">🗂️</span><span>Sessions…</span>';
  if (opts.onOpenSessionList) sessionsBtn.addEventListener('click', opts.onOpenSessionList);
  rail.appendChild(sessionsBtn);

  const railHeading = document.createElement('div');
  railHeading.className = 'hidden md:block px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 select-none';
  railHeading.textContent = 'Workspace';
  rail.appendChild(railHeading);

  // === Right (or bottom on mobile): viewport + tab panes ===
  const rightPane = document.createElement('div');
  rightPane.className = 'flex-1 flex flex-col min-w-0 min-h-0 relative';
  rightPane.appendChild(statusBar);

  const tabInteractive = createRailItem('Interactive', '3D View', '\ud83e\uddca', true);
  tabInteractive.title = 'Live 3D viewport \u2014 orbit, zoom, and inspect';
  // Gallery is folded into Versions: the Versions pane shows the same thumbnail
  // tiles plus rename/delete, so it's a superset. The `gallery` tab/route stays
  // valid for deep links and the AI getViewState() contract, but no longer
  // needs a separate rail item.
  const tabVersions = createRailItem('Versions', 'Versions', '🕒', false);
  tabVersions.title = 'Saved versions — thumbnails, rename, delete';
  const tabImages = createRailItem('Images', 'Images', '📷', false);
  tabImages.title = 'Reference images attached to this session';
  const tabDiff = createRailItem('Diff', 'Diff', '🔀', false);
  tabDiff.title = 'Compare code between two versions';
  const tabNotes = createRailItem('Notes', 'Notes', '📝', false);
  tabNotes.title = 'Session notes and design decisions log';
  const tabData = createRailItem('Data', 'Data', '🗄️', false);
  tabData.title = 'Browse everything Partwright has stored in this browser';

  rail.appendChild(tabInteractive);
  rail.appendChild(tabVersions);
  rail.appendChild(tabImages);
  rail.appendChild(tabDiff);
  rail.appendChild(tabNotes);
  rail.appendChild(tabData);

  // === Bottom utility group ===
  // Catalog, Settings (quality), Diagnostics, Help, Guided tour, and About move
  // out of the top toolbar so it can slim down. `md:mt-auto` on the first item
  // pushes the whole cluster to the bottom of the desktop rail. Element ids are
  // preserved (btn-catalog, btn-quality, btn-diagnostics, btn-help, btn-tour,
  // btn-about, btn-ai) so the tour and existing tests keep finding them.
  const railActionClass = 'flex items-center gap-2 shrink-0 whitespace-nowrap px-3 py-2.5 md:py-2 text-sm md:text-[13px] font-medium text-zinc-400 border-b-2 md:border-b-0 border-transparent [@media(hover:hover)]:hover:text-zinc-200 [@media(hover:hover)]:hover:bg-zinc-800/60 transition-colors';
  const makeAction = (id: string, icon: string, label: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.id = id;
    b.className = railActionClass;
    b.innerHTML = `<span class="text-base leading-none w-5 text-center" aria-hidden="true">${icon}</span><span>${label}</span>`;
    b.addEventListener('click', onClick);
    return b;
  };

  const catalogNavBtn = makeAction('btn-catalog', '📚', 'Catalog', () => opts.onOpenCatalog?.());
  catalogNavBtn.title = 'Browse the catalog of premade models';
  // Separator + push-to-bottom anchor for the whole utility cluster.
  catalogNavBtn.classList.add('md:mt-auto', 'md:border-t', 'md:border-zinc-800');

  const qualityNavBtn = makeAction('btn-quality', '⚙', 'Settings', () => { showQualitySettingsModal(); });
  qualityNavBtn.title = 'Modeling quality (default curve resolution)';
  qualityNavBtn.setAttribute('aria-label', 'Modeling quality settings');

  // Filament palette — your printable colors, used by the paint picker, the
  // Colors remap tool, and (when enforced) AI sessions. Lazy-imported so the
  // modal's AI-provider deps stay out of the core layout chunk.
  const paletteNavBtn = makeAction('btn-palette', '🧵', 'Palette', () => {
    void import('./paletteModal').then(m => m.showPaletteModal());
  });
  paletteNavBtn.title = 'Filament palette — your printable colors (+ AI photo auto-fill)';
  paletteNavBtn.setAttribute('aria-label', 'Filament palette');

  const diagNavBtn = makeAction('btn-diagnostics', '⚠', 'Diagnostics', () => opts.onToggleDiagnostics?.());
  diagNavBtn.classList.add('relative');
  diagNavBtn.title = 'Diagnostic log — errors and warnings';
  diagNavBtn.setAttribute('aria-label', 'Diagnostic log');
  const diagBadge = document.createElement('span');
  diagBadge.id = 'diag-badge';
  diagBadge.className = 'hidden absolute top-1 left-6 text-[8px] font-bold bg-red-500 text-white rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5 leading-none pointer-events-none';
  diagNavBtn.appendChild(diagBadge);

  const helpNavBtn = makeAction('btn-help', '?', 'Help', () => {
    const record = window as unknown as Record<string, unknown>;
    const showHelp = (record.__partwrightShowHelp ?? record.__mainifoldShowHelp) as (() => void) | undefined;
    if (showHelp) showHelp();
  });
  helpNavBtn.title = 'Help';

  // Guided tour — explicit entry point to (re)play the spotlight walkthrough.
  // Sits between Help and About so it reads as part of the "learn the app"
  // cluster. The first-visit tour fires automatically; this lets users start
  // it again on demand.
  const tourNavBtn = makeAction('btn-tour', '🧭', 'Guided tour', () => opts.onStartTour?.());
  tourNavBtn.title = 'Take the guided tour of the editor';
  tourNavBtn.setAttribute('aria-label', 'Take the guided tour');

  // About — build/version info (commit, branch, links) for verifying which
  // Cloudflare branch/PR deploy you're testing.
  const aboutNavBtn = makeAction(
    'btn-about',
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    'About',
    () => { showAboutModal(); },
  );
  aboutNavBtn.title = 'About — build & version info';
  aboutNavBtn.setAttribute('aria-label', 'About this build');

  // AI assistant — toggles the chat drawer rather than a tab pane. Keeps id
  // `btn-ai` so setAiToolbarState, the tour, and tests stay wired up.
  // The AI launcher is the primary entry point to the assistant, so it gets an
  // indigo accent + bolder weight that sets it apart from the muted zinc
  // utility buttons around it — making it obvious where to (re)open the panel.
  const aiNavBtn = document.createElement('button');
  aiNavBtn.id = 'btn-ai';
  aiNavBtn.className = 'flex items-center gap-2 shrink-0 whitespace-nowrap px-3 py-2.5 md:py-2 text-sm md:text-[13px] font-semibold text-indigo-300 border-b-2 md:border-b-0 border-transparent [@media(hover:hover)]:hover:text-indigo-200 [@media(hover:hover)]:hover:bg-indigo-500/10 transition-colors';
  aiNavBtn.title = 'AI chat — not connected. Click to connect an API key or local model.';
  aiNavBtn.innerHTML = '<span id="ai-status-dot" class="w-1.5 h-1.5 rounded-full shrink-0 bg-zinc-500"></span><span class="text-base leading-none w-5 text-center" aria-hidden="true">✦</span><span>AI</span>';
  if (opts.onToggleAi) aiNavBtn.addEventListener('click', opts.onToggleAi);

  rail.appendChild(catalogNavBtn);
  rail.appendChild(qualityNavBtn);
  rail.appendChild(paletteNavBtn);
  rail.appendChild(diagNavBtn);
  rail.appendChild(helpNavBtn);
  rail.appendChild(tourNavBtn);
  rail.appendChild(aboutNavBtn);
  rail.appendChild(aiNavBtn);

  // Reflect the drawer's open/closed state on the AI rail item — a filled
  // indigo background + brighter text while open. The two text shades are
  // toggled mutually exclusively so they never both apply at once.
  window.addEventListener('ai-panel-toggled', (e) => {
    const open = !!(e as CustomEvent).detail?.open;
    aiNavBtn.classList.toggle('bg-indigo-500/20', open);
    aiNavBtn.classList.toggle('text-indigo-100', open);
    aiNavBtn.classList.toggle('text-indigo-300', !open);
  });

  // Tab content panels
  const viewportPane = document.createElement('div');
  viewportPane.id = 'viewport-container';
  viewportPane.className = 'relative flex-1 min-h-0';

  // Clip controls overlay — positioned inside viewport
  const clipControls = createClipControls();
  viewportPane.appendChild(clipControls);

  // Cross-section Z slider — anchored below the orientation gizmo, separate from
  // the toolbar so showing it doesn't shift the buttons.
  const clipSlider = createClipSlider();
  viewportPane.appendChild(clipSlider);

  const galleryContainer = document.createElement('div');
  galleryContainer.id = 'gallery-container';
  galleryContainer.className = 'flex-1 min-h-0 overflow-auto bg-zinc-900 hidden p-4';

  const versionsContainer = document.createElement('div');
  versionsContainer.id = 'versions-container';
  versionsContainer.className = 'flex-1 min-h-0 overflow-auto bg-zinc-900 hidden p-4';

  const imagesContainer = document.createElement('div');
  imagesContainer.id = 'images-container';
  imagesContainer.className = 'flex-1 min-h-0 overflow-auto bg-zinc-900 hidden p-4 flex flex-col';

  const diffContainer = document.createElement('div');
  diffContainer.id = 'diff-container';
  diffContainer.className = 'flex-1 min-h-0 overflow-hidden bg-zinc-900 hidden';

  const notesContainer = document.createElement('div');
  notesContainer.id = 'notes-container';
  notesContainer.className = 'flex-1 min-h-0 overflow-auto bg-zinc-900 hidden p-4 flex flex-col';

  const dataContainer = document.createElement('div');
  dataContainer.id = 'data-container';
  dataContainer.className = 'flex-1 min-h-0 overflow-auto bg-zinc-900 hidden p-4 flex flex-col';

  // Pane shown for each tab. `gallery` and `versions` both still exist (deep
  // links + the AI getViewState() contract) but share one rail item.
  const paneByTab: Record<TabName, HTMLElement> = {
    interactive: viewportPane,
    gallery: galleryContainer,
    versions: versionsContainer,
    images: imagesContainer,
    diff: diffContainer,
    notes: notesContainer,
    data: dataContainer,
  };
  // Rail item highlighted for each tab — gallery + versions both map to Versions.
  const railByTab: Record<TabName, HTMLButtonElement> = {
    interactive: tabInteractive,
    gallery: tabVersions,
    versions: tabVersions,
    images: tabImages,
    diff: tabDiff,
    notes: tabNotes,
    data: tabData,
  };
  const navItems = [tabInteractive, tabVersions, tabImages, tabDiff, tabNotes, tabData];
  const allPanes = Object.values(paneByTab);

  // Mobile-only pane toggle: lets the user swap between editor and viewport
  // when the layout is stacked. Hidden at md+ and on tabs that already hide
  // the editor (Diff).
  const mobilePaneToggle = document.createElement('div');
  mobilePaneToggle.id = 'mobile-pane-toggle';
  mobilePaneToggle.className = 'md:hidden flex items-stretch bg-zinc-800 border-b border-zinc-700 shrink-0';
  const mobileEditorBtn = document.createElement('button');
  mobileEditorBtn.textContent = 'Code';
  mobileEditorBtn.title = 'Show code editor';
  const mobileViewportBtn = document.createElement('button');
  mobileViewportBtn.textContent = 'Viewport';
  mobileViewportBtn.title = 'Show 3D viewport';
  mobilePaneToggle.appendChild(mobileEditorBtn);
  mobilePaneToggle.appendChild(mobileViewportBtn);

  // py-3 (not py-2) keeps these mobile-only toggles ≥44px tall — the minimum
  // fingertip target. The toggle strip is `md:hidden`, so desktop never sees it.
  const MOBILE_TOGGLE_ACTIVE = 'flex-1 px-4 py-3 text-sm font-medium text-zinc-100 border-b-2 border-blue-500 bg-zinc-900';
  const MOBILE_TOGGLE_INACTIVE = 'flex-1 px-4 py-3 text-sm font-medium text-zinc-500 border-b-2 border-transparent';
  function syncMobileToggleUI(pane: 'editor' | 'viewport') {
    mobileEditorBtn.className = pane === 'editor' ? MOBILE_TOGGLE_ACTIVE : MOBILE_TOGGLE_INACTIVE;
    mobileViewportBtn.className = pane === 'viewport' ? MOBILE_TOGGLE_ACTIVE : MOBILE_TOGGLE_INACTIVE;
  }
  mobileEditorBtn.addEventListener('click', () => setMobilePane('editor'));
  mobileViewportBtn.addEventListener('click', () => setMobilePane('viewport'));

  // Tracks the most recently activated tab so breakpoint or mobile-pane
  // changes can recompose visibility without re-running tab DOM toggling.
  let _currentTab: TabName = 'interactive';
  // Default the code pane closed when the AI drawer is opening too — two big
  // surfaces fighting for the same screen on a first visit pushes the viewport
  // into a sliver. The user's explicit Hide/Show choice (persisted below)
  // takes precedence on every subsequent load.
  const aiSettings = loadSettings();
  let editorCollapsed = aiSettings.editorCollapsed ?? aiSettings.drawerOpen;
  const mqDesktop = window.matchMedia('(min-width: 768px)');

  // Composes desktop/mobile pane visibility from the active tab and (on mobile)
  // the persisted mobile pane choice. Also keeps the editor pane's inline
  // width in sync with the breakpoint: only set at md+, cleared on mobile so
  // flex sizing drives height.
  // Expand button — floats at the left edge of rightPane when editor is collapsed.
  const expandEditorBtn = document.createElement('button');
  // No md:flex here — visibility is controlled entirely via classList.add/remove('hidden')
  // so the toggle logic works correctly on all screen sizes.
  expandEditorBtn.className = 'absolute left-0 top-8 z-20 px-2 py-1.5 bg-zinc-800 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700 rounded-r border-r border-t border-b border-zinc-700 text-xs leading-none whitespace-nowrap hidden';
  expandEditorBtn.textContent = '▶ Show code';
  expandEditorBtn.title = 'Show the code editor pane';
  rightPane.appendChild(expandEditorBtn);

  function collapseEditor(): void {
    editorCollapsed = true;
    editorGroup.style.width = '0';
    editorGroup.style.overflow = 'hidden';
    expandEditorBtn.classList.remove('hidden');
    splitter.classList.add('hidden');
    window.dispatchEvent(new Event('resize'));
  }

  function expandEditor(): void {
    editorCollapsed = false;
    editorGroup.style.width = '40%';
    editorGroup.style.overflow = '';
    expandEditorBtn.classList.add('hidden');
    syncPaneVisibility();
    window.dispatchEvent(new Event('resize'));
  }

  function rememberEditorCollapsed(collapsed: boolean): void {
    saveSettings({ ...loadSettings(), editorCollapsed: collapsed });
  }

  collapseEditorBtn.addEventListener('click', () => {
    if (editorCollapsed) expandEditor(); else collapseEditor();
    rememberEditorCollapsed(editorCollapsed);
  });
  expandEditorBtn.addEventListener('click', () => {
    expandEditor();
    rememberEditorCollapsed(false);
  });

  // Apply the resolved initial collapsed state to the DOM before the first
  // syncPaneVisibility() runs below — otherwise the "if (!editorCollapsed)…
  // width = 40%" branch would expand it on the first paint and clobber the
  // resolved default.
  if (editorCollapsed) {
    editorGroup.style.width = '0';
    editorGroup.style.overflow = 'hidden';
    expandEditorBtn.classList.remove('hidden');
    splitter.classList.add('hidden');
  }

  // === Parts rail collapse ===
  // Mirrors the editor collapse: hide the rail to reclaim width, leaving a small
  // floating button at the group's left edge to bring it back.
  let railCollapsed = false;
  const railExpandBtn = document.createElement('button');
  railExpandBtn.className = 'absolute left-0 top-0 z-20 px-1.5 py-1 bg-zinc-800 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700 rounded-br border-r border-b border-zinc-700 text-xs leading-none hidden';
  railExpandBtn.textContent = '»'; // »
  railExpandBtn.title = 'Show parts';
  railExpandBtn.setAttribute('aria-label', 'Show parts');
  editorGroup.appendChild(railExpandBtn);

  function togglePartsRail(): void {
    railCollapsed = !railCollapsed;
    partsRail.classList.toggle('hidden', railCollapsed);
    railExpandBtn.classList.toggle('hidden', !railCollapsed);
    // Re-showing: drop it back into the container that matches the current
    // breakpoint (it may have changed while collapsed).
    if (!railCollapsed) placeParts();
    // The floating » chip sits at the group's top-left; when the rail is
    // collapsed (but the editor open) pad the header so it doesn't overlap the
    // title. Cleared when the rail returns.
    editorHeader.style.paddingLeft = railCollapsed ? '1.75rem' : '';
    window.dispatchEvent(new Event('resize'));
  }
  railExpandBtn.addEventListener('click', togglePartsRail);

  function syncPaneVisibility() {
    const tab = _currentTab;
    const tabHidesEditor = tab === 'diff';
    const isDesktop = mqDesktop.matches;

    if (isDesktop) {
      // Restore inline width if it was cleared on mobile, but not if collapsed.
      if (!editorCollapsed && !editorGroup.style.width) editorGroup.style.width = '40%';
      editorGroup.classList.toggle('hidden', tabHidesEditor);
      splitter.classList.toggle('hidden', tabHidesEditor || editorCollapsed);
      expandEditorBtn.classList.toggle('hidden', tabHidesEditor || !editorCollapsed);
      rightPane.classList.remove('hidden');
      mobilePaneToggle.classList.add('hidden');
    } else {
      // Mobile: clear inline width so flex sizing controls the editor's height.
      editorGroup.style.width = '';
      editorGroup.style.overflow = '';
      splitter.classList.add('hidden');
      expandEditorBtn.classList.add('hidden');
      if (tabHidesEditor) {
        editorGroup.classList.add('hidden');
        rightPane.classList.remove('hidden');
        // No choice to make — hide the toggle on Diff.
        mobilePaneToggle.classList.add('hidden');
      } else {
        const pane = getMobilePane();
        editorGroup.classList.toggle('hidden', pane !== 'editor');
        rightPane.classList.toggle('hidden', pane !== 'viewport');
        mobilePaneToggle.classList.remove('hidden');
        syncMobileToggleUI(pane);
      }
    }
  }

  // Shared tab activation logic (DOM toggling, editor visibility, events)
  function applyTab(tab: TabName) {
    _currentTab = tab;
    const activePane = paneByTab[tab];
    for (const pane of allPanes) pane.classList.toggle('hidden', pane !== activePane);
    const activeItem = railByTab[tab];
    for (const item of navItems) item.className = item === activeItem ? RAIL_ITEM_ACTIVE : RAIL_ITEM_INACTIVE;
    syncPaneVisibility();
    window.dispatchEvent(new CustomEvent('tab-switched', { detail: { tab } }));
    window.dispatchEvent(new Event('resize'));
  }

  // Tab switching — updates URL to reflect current tab
  function switchTab(tab: TabName, options: SwitchTabOptions = {}) {
    applyTab(tab);

    // On mobile the rail is always visible, but every destination pane lives in
    // the right pane (hidden while the editor pane is showing). Reveal it so a
    // tapped rail item actually surfaces its content.
    if (!mqDesktop.matches) setMobilePane('viewport');

    const basePath = '/editor';
    const params = new URLSearchParams(window.location.search);
    // Clear every tab-owned param, then set the one this tab owns. Unrelated
    // params (e.g. `session`, `v`) are preserved. `view` is a legacy param
    // (the old AI/Elevations tabs) — keep clearing it so stale URLs reset.
    params.delete('view');
    params.delete('gallery');
    params.delete('versions');
    params.delete('images');
    params.delete('diff');
    params.delete('notes');
    params.delete('data');
    if (tab === 'gallery') params.set('gallery', '');
    else if (tab === 'versions') params.set('versions', '');
    else if (tab === 'images') params.set('images', '');
    else if (tab === 'diff') params.set('diff', '');
    else if (tab === 'notes') params.set('notes', '');
    else if (tab === 'data') params.set('data', '');
    // interactive: no tab param.
    const newUrl = params.toString()
      ? `${basePath}?${params.toString().replace(/=(?=&|$)/g, '')}`
      : basePath;
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    const historyMode = options.history ?? 'push';
    if (historyMode !== 'none' && newUrl !== currentUrl) {
      if (historyMode === 'replace') {
        window.history.replaceState(null, '', newUrl);
      } else {
        window.history.pushState(null, '', newUrl);
      }
    }
  }

  tabInteractive.addEventListener('click', () => switchTab('interactive'));
  tabVersions.addEventListener('click', () => switchTab('versions'));
  tabImages.addEventListener('click', () => switchTab('images'));
  tabDiff.addEventListener('click', () => switchTab('diff'));
  tabNotes.addEventListener('click', () => switchTab('notes'));
  tabData.addEventListener('click', () => switchTab('data'));

  // Restore tab from URL on initial load (without re-writing the URL)
  const initParams = new URLSearchParams(window.location.search);
  if (initParams.has('data')) {
    applyTab('data');
  } else if (initParams.has('notes')) {
    applyTab('notes');
  } else if (initParams.has('diff')) {
    applyTab('diff');
  } else if (initParams.has('images')) {
    applyTab('images');
  } else if (initParams.has('versions')) {
    applyTab('versions');
  } else if (initParams.has('gallery')) {
    applyTab('gallery');
  }

  rightPane.appendChild(viewportPane);
  rightPane.appendChild(galleryContainer);
  rightPane.appendChild(versionsContainer);
  rightPane.appendChild(imagesContainer);
  rightPane.appendChild(diffContainer);
  rightPane.appendChild(notesContainer);
  rightPane.appendChild(dataContainer);

  editorGroup.appendChild(editorPane);

  // Parts panel placement is breakpoint-dependent. On desktop it stacks INSIDE
  // the activity rail as a flex-1 section between the workspace nav and the
  // bottom utility cluster, so "Workspace" and "Parts" read as one left sidebar
  // (the inner #parts-list scrolls; `md:mt-auto` on the utility cluster keeps it
  // pinned to the bottom in both expanded and collapsed states). On mobile the
  // rail is a horizontal strip, so Parts goes back to its column beside the
  // editor. moving a populated element preserves its children + listeners.
  const PARTS_CLASS_DESKTOP = 'flex flex-col flex-1 min-h-0 border-t border-zinc-800 overflow-hidden';
  const PARTS_CLASS_MOBILE = 'flex flex-col shrink-0 w-36 min-h-0 border-r border-zinc-700 bg-zinc-900/60 overflow-hidden';
  function placeParts(): void {
    if (railCollapsed) return; // hidden either way; reposition when re-shown
    if (mqDesktop.matches) {
      partsRail.className = PARTS_CLASS_DESKTOP;
      rail.insertBefore(partsRail, catalogNavBtn);
    } else {
      partsRail.className = PARTS_CLASS_MOBILE;
      editorGroup.insertBefore(partsRail, editorPane);
    }
  }
  placeParts();

  // Rail first so it sits at the left edge (desktop) / top (mobile), then the
  // editor group, the splitter, and the tabbed right pane.
  main.appendChild(rail);
  main.appendChild(editorGroup);
  main.appendChild(splitter);
  main.appendChild(rightPane);

  // Outer wrapper holds the mobile pane toggle above the panes so it's
  // visible regardless of which pane is currently shown.
  const outer = document.createElement('div');
  outer.className = 'flex flex-col flex-1 min-h-0';
  outer.appendChild(mobilePaneToggle);
  outer.appendChild(main);
  appContainer.appendChild(outer);

  // Apply initial pane visibility now that all elements are in the DOM.
  syncPaneVisibility();

  // Re-compose visibility on breakpoint crossing and on mobile-pane changes.
  // Both must dispatch a resize so the Three.js canvas re-fits.
  const onBreakpointChange = () => {
    placeParts();
    syncPaneVisibility();
    window.dispatchEvent(new Event('resize'));
  };
  if (typeof mqDesktop.addEventListener === 'function') {
    mqDesktop.addEventListener('change', onBreakpointChange);
  } else {
    // Safari < 14 fallback
    (mqDesktop as unknown as { addListener: (cb: () => void) => void }).addListener(onBreakpointChange);
  }
  onMobilePaneChange(() => {
    syncPaneVisibility();
    window.dispatchEvent(new Event('resize'));
  });

  return { editorPane, partsRail, editorContainer, editorErrorPanel, viewportPane, galleryContainer, versionsContainer, imagesContainer, diffContainer, notesContainer, dataContainer, statusBar, clipControls, formatBtn, autoFormatToggle, switchTab, togglePartsRail, collapseEditor, expandEditor };
}

// Rail item base — a bottom accent border on mobile (horizontal strip) becomes
// a left accent border on desktop (vertical rail) for the active item.
const RAIL_ITEM_BASE = 'flex items-center gap-2 shrink-0 whitespace-nowrap px-3 py-2.5 md:py-2 text-sm md:text-[13px] font-medium transition-colors border-b-2 md:border-b-0 md:border-l-2';
const RAIL_ITEM_ACTIVE = RAIL_ITEM_BASE + ' text-zinc-100 bg-zinc-800 border-blue-500';
const RAIL_ITEM_INACTIVE = RAIL_ITEM_BASE + ' text-zinc-400 border-transparent [@media(hover:hover)]:hover:text-zinc-200 [@media(hover:hover)]:hover:bg-zinc-800/60';

// `canonical` is the stable TabName label kept on data-tab (tests/tour/links
// depend on it); `display` + `icon` are presentational only.
function createRailItem(canonical: string, display: string, icon: string, active: boolean): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = active ? RAIL_ITEM_ACTIVE : RAIL_ITEM_INACTIVE;
  btn.dataset.tab = canonical;
  // icon comes from a fixed in-source set, never user input.
  btn.innerHTML = `<span class="text-base leading-none w-5 text-center" aria-hidden="true">${icon}</span><span>${display}</span>`;
  return btn;
}

function createClipControls(): HTMLElement {
  const container = document.createElement('div');
  container.id = 'clip-controls';
  container.className = 'absolute top-2 right-2 z-10 flex flex-wrap justify-end items-center gap-2 max-w-[calc(100%-1rem)]';

  // Live triangle count of the displayed model — sits at the left of the bar.
  // Non-interactive readout, updated on every mesh change (run/paint/simplify).
  const triCount = document.createElement('div');
  triCount.id = 'triangle-count';
  triCount.className = 'px-2 py-1 rounded text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 border border-zinc-600/50 tabular-nums select-none';
  triCount.title = 'Triangle count of the current model (updates as you edit and paint)';
  triCount.textContent = '— tris';
  container.appendChild(triCount);

  // Mesh edge (wireframe) toggle (off by default) — sits left of the grid toggle
  const wireBtn = document.createElement('button');
  wireBtn.id = 'wireframe-toggle';
  wireBtn.className = 'px-3 py-2 md:px-2 md:py-1 rounded text-sm md:text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 [@media(hover:hover)]:hover:text-zinc-200 [@media(hover:hover)]:hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
  wireBtn.textContent = '△ Edges';
  wireBtn.title = 'Show mesh edges';
  container.appendChild(wireBtn);

  // Grid toggle (off by default)
  const gridBtn = document.createElement('button');
  gridBtn.id = 'grid-toggle';
  gridBtn.className = 'px-3 py-2 md:px-2 md:py-1 rounded text-sm md:text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 [@media(hover:hover)]:hover:text-zinc-200 [@media(hover:hover)]:hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
  gridBtn.textContent = '\u25A6 Grid';
  gridBtn.title = 'Show grid plane';
  container.appendChild(gridBtn);

  // Dimensions toggle (on by default)
  const dimBtn = document.createElement('button');
  dimBtn.id = 'dimensions-toggle';
  dimBtn.className = 'px-3 py-2 md:px-2 md:py-1 rounded text-sm md:text-xs bg-blue-500/20 backdrop-blur text-blue-400 [@media(hover:hover)]:hover:bg-blue-500/30 transition-colors border border-blue-500/30';
  dimBtn.textContent = '\u2B1A Dims';
  dimBtn.title = 'Toggle bounding box dimensions';
  container.appendChild(dimBtn);

  // Orbit lock toggle
  const lockBtn = document.createElement('button');
  lockBtn.id = 'orbit-lock-toggle';
  lockBtn.className = 'px-3 py-2 md:px-2 md:py-1 rounded text-sm md:text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 [@media(hover:hover)]:hover:text-zinc-200 [@media(hover:hover)]:hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
  lockBtn.textContent = '\uD83D\uDD13 Lock';
  lockBtn.title = 'Lock camera rotation';
  container.appendChild(lockBtn);

  // Visual separator between the view toggles (above) and the tools that follow
  // (Measure, Cross Section, plus the injected Paint/Annotate/Simplify buttons).
  const divider = document.createElement('div');
  divider.className = 'hidden md:block w-px self-stretch bg-zinc-600/50 mx-0.5';
  container.appendChild(divider);

  // Measure toggle button
  const measureBtn = document.createElement('button');
  measureBtn.id = 'measure-toggle';
  measureBtn.className = 'px-3 py-2 md:px-2 md:py-1 rounded text-sm md:text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 [@media(hover:hover)]:hover:text-zinc-200 [@media(hover:hover)]:hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
  measureBtn.textContent = '\uD83D\uDCCF Measure';
  measureBtn.title = 'Measure distance between two points on your model';
  container.appendChild(measureBtn);

  // Clip toggle button
  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'clip-toggle';
  toggleBtn.className = 'px-3 py-2 md:px-2 md:py-1 rounded text-sm md:text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 [@media(hover:hover)]:hover:text-zinc-200 [@media(hover:hover)]:hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
  toggleBtn.textContent = '\u2702 Cross Section';
  toggleBtn.title = 'Toggle cross-section clipping plane';
  container.appendChild(toggleBtn);

  return container;
}

// Vertical Z slider for the cross-section plane. Kept out of the toolbar's flex
// flow and anchored directly below the orientation gizmo (top-right) so toggling
// clip never reflows the toolbar buttons. Hidden until clip is active.
function createClipSlider(): HTMLElement {
  // The orientation gizmo occupies a 128px square at the viewport's top-right
  // corner (8px margin). Mirror that footprint here so the slider centers under
  // it; pointer-events-none lets clicks fall through the empty anchor box to the
  // model, while the slider group itself re-enables them.
  const anchor = document.createElement('div');
  anchor.id = 'clip-slider-anchor';
  anchor.className = 'absolute right-2 top-36 z-10 w-32 flex justify-center pointer-events-none';

  const sliderGroup = document.createElement('div');
  sliderGroup.id = 'clip-slider-group';
  sliderGroup.className = 'hidden flex flex-col items-center gap-2 px-2 py-2 rounded bg-zinc-800/80 backdrop-blur border border-zinc-600/50 pointer-events-auto';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.id = 'clip-z-slider';
  // Vertical orientation: writing-mode flips the range to grow top-to-bottom;
  // direction:rtl puts the max (highest Z) at the top, min at the bottom.
  slider.className = 'h-56 accent-red-400 cursor-pointer [writing-mode:vertical-lr] [direction:rtl]';
  slider.min = '0';
  slider.max = '10';
  slider.step = '0.01';
  slider.value = '5';
  sliderGroup.appendChild(slider);

  const zLabel = document.createElement('span');
  zLabel.id = 'clip-z-label';
  zLabel.className = 'text-xs text-zinc-300 font-mono text-center';
  zLabel.textContent = 'Z: 5.00';
  sliderGroup.appendChild(zLabel);

  anchor.appendChild(sliderGroup);
  return anchor;
}

function initSplitter(splitter: HTMLElement, editorPane: HTMLElement) {
  let startX = 0;
  let startWidth = 0;
  let activePointerId: number | null = null;

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerId !== activePointerId) return;
    const newWidth = startWidth + (e.clientX - startX);
    const minW = 200;
    const maxW = window.innerWidth - 200;
    editorPane.style.width = `${Math.max(minW, Math.min(maxW, newWidth))}px`;
    window.dispatchEvent(new Event('resize'));
  };

  const onPointerEnd = (e: PointerEvent) => {
    if (e.pointerId !== activePointerId) return;
    activePointerId = null;
    splitter.classList.remove('is-dragging');
    try { splitter.releasePointerCapture(e.pointerId); } catch { /* no capture */ }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  splitter.addEventListener('pointerdown', (e) => {
    // Ignore secondary buttons; allow primary mouse, touch, and pen.
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    activePointerId = e.pointerId;
    startX = e.clientX;
    startWidth = editorPane.getBoundingClientRect().width;
    splitter.setPointerCapture(e.pointerId);
    splitter.classList.add('is-dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  splitter.addEventListener('pointermove', onPointerMove);
  splitter.addEventListener('pointerup', onPointerEnd);
  splitter.addEventListener('pointercancel', onPointerEnd);
}
