import { getMobilePane, onMobilePaneChange, setMobilePane } from './mobilePane';

export type TabName = 'interactive' | 'gallery' | 'versions' | 'images' | 'diff' | 'notes' | 'data';

export interface LayoutElements {
  editorPane: HTMLElement;
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
}

export interface SwitchTabOptions {
  history?: 'push' | 'replace' | 'none';
}

export function createLayout(appContainer: HTMLElement): LayoutElements {
  const main = document.createElement('div');
  // Stack panes vertically on narrow viewports, side-by-side at md+.
  main.className = 'flex flex-col md:flex-row flex-1 min-h-0';

  // === Left (or top on mobile): Editor pane ===
  // Width is only applied via inline style at md+ (see syncEditorPaneWidth).
  // On mobile the pane uses flex sizing so both panes share the vertical space.
  const editorPane = document.createElement('div');
  editorPane.className = 'flex flex-col flex-1 md:flex-none min-h-0 border-b md:border-b-0 md:border-r border-zinc-700';

  const editorHeader = document.createElement('div');
  editorHeader.className = 'flex items-center px-3 py-1.5 bg-zinc-800 border-b border-zinc-700 gap-2';

  const editorTitle = document.createElement('span');
  editorTitle.id = 'editor-title';
  editorTitle.className = 'text-xs text-zinc-400 font-mono';
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
  statusBar.className = 'text-xs text-emerald-400 font-mono';
  statusBar.textContent = 'Ready';
  editorHeader.appendChild(statusBar);

  const collapseEditorBtn = document.createElement('button');
  collapseEditorBtn.className = 'shrink-0 px-2 py-0.5 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 text-xs leading-none border border-transparent hover:border-zinc-600';
  collapseEditorBtn.textContent = 'Hide code';
  collapseEditorBtn.title = 'Hide the code editor pane';
  editorHeader.appendChild(collapseEditorBtn);

  editorPane.appendChild(editorHeader);

  const editorErrorPanel = document.createElement('div');
  editorErrorPanel.id = 'editor-error-panel';
  editorErrorPanel.className = 'hidden border-b border-red-500/30 bg-red-950/40 px-3 py-2 text-xs text-red-100';
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
  initSplitter(splitter, editorPane);

  // === Right (or bottom on mobile): Tabbed viewport ===
  const rightPane = document.createElement('div');
  rightPane.className = 'flex-1 flex flex-col min-w-0 min-h-0 relative';

  // Tab bar — horizontally scrollable on narrow viewports so all tabs stay reachable.
  const tabBar = document.createElement('div');
  tabBar.className = 'flex items-stretch bg-zinc-800 border-b border-zinc-700 shrink-0 overflow-x-auto [scrollbar-width:thin]';

  const tabInteractive = createTab('Interactive', true);
  tabInteractive.title = 'Live 3D viewport \u2014 orbit, zoom, and inspect';
  const tabGallery = createTab('Gallery', false);
  tabGallery.title = 'Compare saved versions side-by-side';
  const tabVersions = createTab('Versions', false);
  tabVersions.title = 'Manage saved versions — rename and delete';
  const tabImages = createTab('Images', false);
  tabImages.title = 'Reference images attached to this session';
  const tabDiff = createTab('Diff', false);
  tabDiff.title = 'Compare code between two versions';
  const tabNotes = createTab('Notes', false);
  tabNotes.title = 'Session notes and design decisions log';
  const tabData = createTab('Data', false);
  tabData.title = 'Browse everything Partwright has stored in this browser';

  tabBar.appendChild(tabInteractive);
  tabBar.appendChild(tabGallery);
  tabBar.appendChild(tabVersions);
  tabBar.appendChild(tabImages);
  tabBar.appendChild(tabDiff);
  tabBar.appendChild(tabNotes);
  tabBar.appendChild(tabData);

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

  const allTabs = [tabInteractive, tabGallery, tabVersions, tabImages, tabDiff, tabNotes, tabData];
  const allPanes = [viewportPane, galleryContainer, versionsContainer, imagesContainer, diffContainer, notesContainer, dataContainer];

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

  const MOBILE_TOGGLE_ACTIVE = 'flex-1 px-4 py-2 text-sm font-medium text-zinc-100 border-b-2 border-blue-500 bg-zinc-900';
  const MOBILE_TOGGLE_INACTIVE = 'flex-1 px-4 py-2 text-sm font-medium text-zinc-500 border-b-2 border-transparent';
  function syncMobileToggleUI(pane: 'editor' | 'viewport') {
    mobileEditorBtn.className = pane === 'editor' ? MOBILE_TOGGLE_ACTIVE : MOBILE_TOGGLE_INACTIVE;
    mobileViewportBtn.className = pane === 'viewport' ? MOBILE_TOGGLE_ACTIVE : MOBILE_TOGGLE_INACTIVE;
  }
  mobileEditorBtn.addEventListener('click', () => setMobilePane('editor'));
  mobileViewportBtn.addEventListener('click', () => setMobilePane('viewport'));

  // Tracks the most recently activated tab so breakpoint or mobile-pane
  // changes can recompose visibility without re-running tab DOM toggling.
  let _currentTab: TabName = 'interactive';
  let editorCollapsed = false;
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
    editorPane.style.width = '0';
    editorPane.style.overflow = 'hidden';
    expandEditorBtn.classList.remove('hidden');
    splitter.classList.add('hidden');
    window.dispatchEvent(new Event('resize'));
  }

  function expandEditor(): void {
    editorCollapsed = false;
    editorPane.style.width = '35%';
    editorPane.style.overflow = '';
    expandEditorBtn.classList.add('hidden');
    syncPaneVisibility();
    window.dispatchEvent(new Event('resize'));
  }

  collapseEditorBtn.addEventListener('click', () => {
    if (editorCollapsed) expandEditor(); else collapseEditor();
  });
  expandEditorBtn.addEventListener('click', expandEditor);

  function syncPaneVisibility() {
    const tab = _currentTab;
    const tabHidesEditor = tab === 'diff';
    const isDesktop = mqDesktop.matches;

    if (isDesktop) {
      // Restore inline width if it was cleared on mobile, but not if collapsed.
      if (!editorCollapsed && !editorPane.style.width) editorPane.style.width = '35%';
      editorPane.classList.toggle('hidden', tabHidesEditor);
      splitter.classList.toggle('hidden', tabHidesEditor || editorCollapsed);
      expandEditorBtn.classList.toggle('hidden', tabHidesEditor || !editorCollapsed);
      rightPane.classList.remove('hidden');
      mobilePaneToggle.classList.add('hidden');
    } else {
      // Mobile: clear inline width so flex sizing controls the editor's height.
      editorPane.style.width = '';
      editorPane.style.overflow = '';
      splitter.classList.add('hidden');
      expandEditorBtn.classList.add('hidden');
      if (tabHidesEditor) {
        editorPane.classList.add('hidden');
        rightPane.classList.remove('hidden');
        // No choice to make — hide the toggle on Diff.
        mobilePaneToggle.classList.add('hidden');
      } else {
        const pane = getMobilePane();
        editorPane.classList.toggle('hidden', pane !== 'editor');
        rightPane.classList.toggle('hidden', pane !== 'viewport');
        mobilePaneToggle.classList.remove('hidden');
        syncMobileToggleUI(pane);
      }
    }
  }

  // Shared tab activation logic (DOM toggling, editor visibility, events)
  function applyTab(tab: TabName) {
    _currentTab = tab;
    const idx = tab === 'interactive' ? 0 : tab === 'gallery' ? 1 : tab === 'versions' ? 2 : tab === 'images' ? 3 : tab === 'diff' ? 4 : tab === 'notes' ? 5 : 6;
    for (let i = 0; i < allPanes.length; i++) {
      if (i === idx) {
        allPanes[i].classList.remove('hidden');
        allTabs[i].className = TAB_ACTIVE_CLASS;
      } else {
        allPanes[i].classList.add('hidden');
        allTabs[i].className = TAB_INACTIVE_CLASS;
      }
    }
    syncPaneVisibility();
    window.dispatchEvent(new CustomEvent('tab-switched', { detail: { tab } }));
    window.dispatchEvent(new Event('resize'));
  }

  // Tab switching — updates URL to reflect current tab
  function switchTab(tab: TabName, options: SwitchTabOptions = {}) {
    applyTab(tab);

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
  tabGallery.addEventListener('click', () => switchTab('gallery'));
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

  rightPane.appendChild(tabBar);
  rightPane.appendChild(viewportPane);
  rightPane.appendChild(galleryContainer);
  rightPane.appendChild(versionsContainer);
  rightPane.appendChild(imagesContainer);
  rightPane.appendChild(diffContainer);
  rightPane.appendChild(notesContainer);
  rightPane.appendChild(dataContainer);

  main.appendChild(editorPane);
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

  return { editorPane, editorContainer, editorErrorPanel, viewportPane, galleryContainer, versionsContainer, imagesContainer, diffContainer, notesContainer, dataContainer, statusBar, clipControls, formatBtn, autoFormatToggle, switchTab };
}

const TAB_ACTIVE_CLASS = 'shrink-0 whitespace-nowrap px-4 py-2 md:py-1.5 text-sm md:text-xs font-medium text-zinc-100 border-b-2 border-blue-500 bg-zinc-900';
const TAB_INACTIVE_CLASS = 'shrink-0 whitespace-nowrap px-4 py-2 md:py-1.5 text-sm md:text-xs font-medium text-zinc-500 [@media(hover:hover)]:hover:text-zinc-300 border-b-2 border-transparent';

function createTab(label: string, active: boolean): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = active ? TAB_ACTIVE_CLASS : TAB_INACTIVE_CLASS;
  btn.textContent = label;
  btn.dataset.tab = label;
  return btn;
}

function createClipControls(): HTMLElement {
  const container = document.createElement('div');
  container.id = 'clip-controls';
  container.className = 'absolute top-2 right-2 z-10 flex flex-wrap justify-end items-center gap-2 max-w-[calc(100%-1rem)]';

  // Mesh edge (wireframe) toggle (off by default) — sits left of the grid toggle
  const wireBtn = document.createElement('button');
  wireBtn.id = 'wireframe-toggle';
  wireBtn.className = 'px-3 py-2 md:px-2 md:py-1 rounded text-sm md:text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 [@media(hover:hover)]:hover:text-zinc-200 [@media(hover:hover)]:hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
  wireBtn.textContent = '△';
  wireBtn.title = 'Show mesh edges';
  container.appendChild(wireBtn);

  // Grid toggle (off by default)
  const gridBtn = document.createElement('button');
  gridBtn.id = 'grid-toggle';
  gridBtn.className = 'px-3 py-2 md:px-2 md:py-1 rounded text-sm md:text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 [@media(hover:hover)]:hover:text-zinc-200 [@media(hover:hover)]:hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
  gridBtn.textContent = '\u25A6';
  gridBtn.title = 'Show grid plane';
  container.appendChild(gridBtn);

  // Dimensions toggle (on by default)
  const dimBtn = document.createElement('button');
  dimBtn.id = 'dimensions-toggle';
  dimBtn.className = 'px-3 py-2 md:px-2 md:py-1 rounded text-sm md:text-xs bg-blue-500/20 backdrop-blur text-blue-400 [@media(hover:hover)]:hover:bg-blue-500/30 transition-colors border border-blue-500/30';
  dimBtn.textContent = '\uD83D\uDCCF';
  dimBtn.title = 'Toggle bounding box dimensions';
  container.appendChild(dimBtn);

  // Orbit lock toggle
  const lockBtn = document.createElement('button');
  lockBtn.id = 'orbit-lock-toggle';
  lockBtn.className = 'px-3 py-2 md:px-2 md:py-1 rounded text-sm md:text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 [@media(hover:hover)]:hover:text-zinc-200 [@media(hover:hover)]:hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
  lockBtn.textContent = '\uD83D\uDD13';
  lockBtn.title = 'Lock camera rotation';
  container.appendChild(lockBtn);

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
