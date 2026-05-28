// First-visit guided tour — spotlight-based coach marks

const STORAGE_KEY = 'partwright-tour-completed';

interface TourStep {
  target: string;
  title: string;
  description: string;
  placement: 'top' | 'bottom' | 'left' | 'right';
}

const STEPS: TourStep[] = [
  {
    target: '#editor-container',
    title: 'Code Editor',
    description:
      'Write code to create 3D geometry using primitives, booleans, and transforms. Supports JavaScript (manifold-3d API) and OpenSCAD (.scad). When an AI agent is driving, it writes and updates code here automatically.',
    placement: 'right',
  },
  {
    target: '#lang-toggle',
    title: 'Language Toggle',
    description:
      'Switch between JavaScript and OpenSCAD. Your draft in each language is preserved when you flip, and saved versions remember the engine they were authored in.',
    placement: 'bottom',
  },
  {
    target: '#btn-auto-run',
    title: 'Live Rendering',
    description:
      'Code re-renders automatically as you type. Click to pause auto-render if your model gets complex. AI agents trigger renders via the console API without needing this button.',
    placement: 'bottom',
  },
  {
    target: '#viewport-container',
    title: '3D Viewport',
    description:
      'Orbit (drag), zoom (scroll), and pan (right-drag) to inspect your model from any angle. AI agents use the isometric views and elevation tabs for visual verification instead.',
    placement: 'left',
  },
  {
    target: '#wireframe-toggle',
    title: 'Mesh Edges',
    description:
      'Overlay the model’s mesh edges (wireframe) on the shaded surface to check topology and triangle density — useful before exporting or simplifying.',
    placement: 'left',
  },
  {
    target: '#paint-toggle',
    title: 'Paint Colors',
    description:
      'Paint coplanar regions of the model in color for multi-color 3D prints (exported via 3MF or OBJ). Painting locks the version read-only until you unlock it; the AI can paint too when its Paint scope is on.',
    placement: 'left',
  },
  {
    target: '#simplify-toggle',
    title: 'Simplify',
    description:
      'Reduce a dense model’s triangle count to a target budget — great for shrinking imported STLs or heavy booleans. Set a target, click Apply to run it, then save the result as a new version.',
    placement: 'left',
  },
  {
    target: '#session-bar',
    title: 'Sessions & Versions',
    description:
      'Create sessions to track iterations. Save versions and navigate between them. AI agents create sessions and save versions automatically as they iterate on your design.',
    placement: 'bottom',
  },
  {
    target: '[data-tab="Images"]',
    title: 'Reference Images',
    description:
      'Attach photos or renderings the model should match. Each image is tagged with an angle (front, right, etc.) and shown next to the matching elevation view for visual comparison.',
    placement: 'bottom',
  },
  {
    target: '[data-tab="Notes"]',
    title: 'Design Notes',
    description:
      'Log requirements, decisions, feedback, and measurements alongside your design. AI agents write notes automatically to capture the design story — review them to see why each change was made.',
    placement: 'bottom',
  },
  {
    target: '[data-tab="Versions"]',
    title: 'Versions',
    description:
      'Every save is a version with a thumbnail. Open the Versions workspace to compare iterations, rename them, or roll back — AI agents can deep-link here to review the whole history at a glance.',
    placement: 'bottom',
  },
  {
    target: '#btn-catalog',
    title: 'Catalog',
    description:
      'Browse a catalog of premade models. Open one as a starting point and tweak the code yourself — or hand it to the AI to remix.',
    placement: 'bottom',
  },
  {
    target: '#import-wrapper',
    title: 'Import',
    description:
      'Import an .stl mesh, a .js / .scad source file, or a full .partwright.json session. Imported meshes render right away and can be edited or combined with new geometry.',
    placement: 'bottom',
  },
  {
    target: '#export-wrapper',
    title: 'Export',
    description: 'Download your model as GLB, STL, OBJ, or 3MF for 3D printing or other tools.',
    placement: 'bottom',
  },
  {
    target: '#btn-ai',
    title: 'AI Chat',
    description:
      'Chat with an AI to build and refine models for you. Use Anthropic, OpenAI, or Google Gemini with your own key — or run a model entirely in your browser with WebGPU, no key needed. Budget presets and the Thinking pill tune cost vs. quality, and the review button gets a second opinion from another provider.',
    placement: 'bottom',
  },
];

let currentStep = 0;
let backdrop: HTMLElement | null = null;
let spotlight: HTMLElement | null = null;
let tooltip: HTMLElement | null = null;
let keyHandler: ((e: KeyboardEvent) => void) | null = null;
let resizeHandler: (() => void) | null = null;

/** Start the tour if not already completed and not an AI agent URL */
export function maybeStartTour(): void {
  if (localStorage.getItem(STORAGE_KEY)) return;

  const params = new URLSearchParams(window.location.search);
  if (params.has('view') || params.has('session') || params.has('gallery') || params.has('versions') || params.has('images') || params.has('notes')) return;

  setTimeout(() => startTour(), 800);
}

/** Start (or restart) the tour */
export function startTour(): void {
  currentStep = 0;
  createOverlay();
  showStep();
}

/** End the tour and clean up */
export function endTour(): void {
  localStorage.setItem(STORAGE_KEY, new Date().toISOString());
  cleanup();
}

/** Clear completion state so tour can show again */
export function resetTour(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** Whether the first-run tour has been completed (or skipped). */
export function isTourCompleted(): boolean {
  return !!localStorage.getItem(STORAGE_KEY);
}

function createOverlay(): void {
  cleanup();

  backdrop = document.createElement('div');
  backdrop.className = 'tour-backdrop';
  backdrop.addEventListener('click', (e) => e.stopPropagation());

  spotlight = document.createElement('div');
  spotlight.className = 'tour-spotlight';

  tooltip = document.createElement('div');
  tooltip.className = 'tour-tooltip';

  document.body.appendChild(backdrop);
  document.body.appendChild(spotlight);
  document.body.appendChild(tooltip);

  keyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { endTour(); return; }
    if (e.key === 'Enter' || e.key === 'ArrowRight') { nextStep(); return; }
    if (e.key === 'ArrowLeft') { prevStep(); return; }
  };
  document.addEventListener('keydown', keyHandler);

  resizeHandler = debounce(() => showStep(), 100);
  window.addEventListener('resize', resizeHandler);
}

function cleanup(): void {
  backdrop?.remove();
  spotlight?.remove();
  tooltip?.remove();
  backdrop = null;
  spotlight = null;
  tooltip = null;

  if (keyHandler) {
    document.removeEventListener('keydown', keyHandler);
    keyHandler = null;
  }
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler);
    resizeHandler = null;
  }
}

function showStep(): void {
  if (!spotlight || !tooltip) return;

  // Find next valid step (skip missing targets)
  while (currentStep < STEPS.length) {
    const step = STEPS[currentStep];
    const target = document.querySelector(step.target);
    if (target) break;
    currentStep++;
  }

  if (currentStep >= STEPS.length) {
    endTour();
    return;
  }

  const step = STEPS[currentStep];
  const target = document.querySelector(step.target) as HTMLElement;
  const rect = target.getBoundingClientRect();
  const pad = 8;

  // Position spotlight cutout
  spotlight.style.top = `${rect.top - pad}px`;
  spotlight.style.left = `${rect.left - pad}px`;
  spotlight.style.width = `${rect.width + pad * 2}px`;
  spotlight.style.height = `${rect.height + pad * 2}px`;

  // Build tooltip content
  const isLast = currentStep >= STEPS.length - 1;
  tooltip.innerHTML = '';

  const title = document.createElement('div');
  title.className = 'text-sm font-semibold text-zinc-100';
  title.textContent = step.title;

  const desc = document.createElement('div');
  desc.className = 'text-xs text-zinc-400 leading-relaxed mt-1';
  desc.textContent = step.description;

  const footer = document.createElement('div');
  footer.className = 'flex items-center justify-between mt-3';

  const counter = document.createElement('span');
  counter.className = 'text-xs text-zinc-500';
  counter.textContent = `${currentStep + 1} / ${STEPS.length}`;

  const buttons = document.createElement('div');
  buttons.className = 'flex items-center gap-2';

  const skipBtn = document.createElement('button');
  skipBtn.className = 'text-xs text-zinc-500 hover:text-zinc-300 transition-colors';
  skipBtn.textContent = 'Skip';
  skipBtn.addEventListener('click', endTour);

  const nextBtn = document.createElement('button');
  nextBtn.className = 'px-3 py-1 rounded text-xs bg-blue-600 hover:bg-blue-500 text-white transition-colors';
  nextBtn.textContent = isLast ? 'Done' : 'Next';
  nextBtn.addEventListener('click', isLast ? endTour : nextStep);

  buttons.appendChild(skipBtn);
  buttons.appendChild(nextBtn);
  footer.appendChild(counter);
  footer.appendChild(buttons);

  // Arrow element
  const arrow = document.createElement('div');
  arrow.className = `tour-arrow tour-arrow-${step.placement}`;

  tooltip.appendChild(title);
  tooltip.appendChild(desc);
  tooltip.appendChild(footer);
  tooltip.appendChild(arrow);

  // Position tooltip relative to spotlight
  positionTooltip(rect, step.placement);

  // Animate in
  requestAnimationFrame(() => {
    tooltip?.classList.add('visible');
  });
}

function positionTooltip(targetRect: DOMRect, placement: string): void {
  if (!tooltip) return;

  const gap = 16;
  const margin = 16;
  const tooltipWidth = 320;
  tooltip.style.width = `${tooltipWidth}px`;

  // Force layout to get tooltip height
  tooltip.style.visibility = 'hidden';
  tooltip.style.display = 'block';
  const tooltipHeight = tooltip.offsetHeight;
  tooltip.style.visibility = '';

  let top = 0;
  let left = 0;

  switch (placement) {
    case 'bottom':
      top = targetRect.bottom + gap;
      left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
      break;
    case 'top':
      top = targetRect.top - tooltipHeight - gap;
      left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
      break;
    case 'right':
      top = targetRect.top + targetRect.height / 2 - tooltipHeight / 2;
      left = targetRect.right + gap;
      break;
    case 'left':
      top = targetRect.top + targetRect.height / 2 - tooltipHeight / 2;
      left = targetRect.left - tooltipWidth - gap;
      break;
  }

  // Clamp to viewport
  const maxLeft = window.innerWidth - tooltipWidth - margin;
  left = Math.max(margin, Math.min(maxLeft, left));
  top = Math.max(margin, Math.min(window.innerHeight - tooltipHeight - margin, top));

  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;
}

function nextStep(): void {
  currentStep++;
  if (currentStep >= STEPS.length) {
    endTour();
  } else {
    tooltip?.classList.remove('visible');
    showStep();
  }
}

function prevStep(): void {
  if (currentStep > 0) {
    currentStep--;
    tooltip?.classList.remove('visible');
    showStep();
  }
}

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout>;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}
