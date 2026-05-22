// Text sub-mode — single-click to anchor an editable input on the session
// plane. Pressing Enter commits the typed text as a TextAnnotation; Escape
// cancels. Like pen-mode, text-mode operates on the active session plane —
// no surface raycasting against the mesh.

import * as THREE from 'three';
import { addText, type TextAnnotation } from './annotations';
import {
  getOverlayGroup,
} from './annotationOverlay';
import {
  startSession,
  endSession,
  showPlaneOutline,
  hidePlaneOutline,
  screenToActivePlane,
  getActiveSession,
} from './sessionPlane';
import {
  getRenderer,
  setUserOrbitLock,
  isUserOrbitLocked,
} from '../renderer/viewport';
import { forceDeactivate as forceDeactivatePaint } from '../color/paintUI';
import { forceDeactivate as closeSimplifyMenu } from '../ui/simplifyUI';
import { forceDeactivate as forceDeactivatePen } from './annotateMode';
import { forceDeactivate as forceDeactivateSelect } from './selectMode';

const DEFAULT_COLOR: [number, number, number] = [0.95, 0.20, 0.45];
const DEFAULT_FONT_SIZE = 28;

let active = false;
let priorOrbitLock = false;
let currentColor: [number, number, number] = [...DEFAULT_COLOR] as [number, number, number];
let currentFontSize = DEFAULT_FONT_SIZE;

let activeInput: HTMLInputElement | null = null;
let activeAnchor: THREE.Vector3 | null = null;

const listeners: Array<(active: boolean) => void> = [];

export function isActive(): boolean {
  return active;
}

export function getColor(): [number, number, number] {
  return [...currentColor] as [number, number, number];
}

export function setColor(c: [number, number, number]): void {
  currentColor = [c[0], c[1], c[2]];
}

export function getFontSize(): number {
  return currentFontSize;
}

export function setFontSize(px: number): void {
  currentFontSize = px;
}

export function onActiveChange(fn: (active: boolean) => void): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

function notifyActiveChange(): void {
  for (const fn of listeners) fn(active);
}

export function activate(): void {
  if (active) return;
  forceDeactivatePaint();
  closeSimplifyMenu();
  forceDeactivateSelect();

  // Reuse existing session if there is one (pen→text switch); otherwise start.
  if (!getActiveSession()) startSession();

  active = true;
  priorOrbitLock = isUserOrbitLocked();
  setUserOrbitLock(true);

  const overlay = getOverlayGroup();
  if (overlay) showPlaneOutline(overlay);

  const canvas = getRenderer().domElement;
  canvas.addEventListener('click', onCanvasClick);
  canvas.style.cursor = 'text';

  notifyActiveChange();

  // Stop pen mode but keep the session alive so we share the plane.
  forceDeactivatePen({ keepSession: true });
}

export function deactivate(): void {
  if (!active) return;
  active = false;
  cancelInProgress();
  if (!priorOrbitLock) setUserOrbitLock(false);

  const canvas = getRenderer().domElement;
  canvas.removeEventListener('click', onCanvasClick);
  canvas.style.cursor = '';

  notifyActiveChange();
}

interface DeactivateOpts { keepSession?: boolean }

export function forceDeactivate(opts: DeactivateOpts = {}): void {
  if (!active) return;
  deactivate();
  if (!opts.keepSession) {
    hidePlaneOutline();
    endSession();
  }
}

function cancelInProgress(): void {
  removeInput();
  activeAnchor = null;
}

function removeInput(): void {
  if (!activeInput) return;
  activeInput.remove();
  activeInput = null;
}

function onCanvasClick(event: MouseEvent): void {
  if (event.button !== 0) return;
  const anchor = screenToActivePlane(event);
  if (!anchor) return;

  if (activeInput) commitFromInput();

  activeAnchor = anchor;
  showInputAt(event.clientX, event.clientY);
  event.preventDefault();
}

function showInputAt(clientX: number, clientY: number): void {
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Type label, Enter to add';
  input.maxLength = 100;
  input.className = 'fixed z-[100] px-2 py-1 text-xs font-mono bg-zinc-900/95 text-white border border-pink-400/70 rounded shadow-xl outline-none focus:ring-2 focus:ring-pink-400/50';
  input.style.left = `${Math.round(clientX)}px`;
  input.style.top = `${Math.round(clientY - 10)}px`;
  input.style.transform = 'translate(-50%, -100%)';
  input.style.minWidth = '160px';

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitFromInput();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelInProgress();
    }
    e.stopPropagation();
  });
  input.addEventListener('blur', () => {
    if (input.value.trim()) commitFromInput();
    else cancelInProgress();
  });

  document.body.appendChild(input);
  activeInput = input;
  setTimeout(() => input.focus(), 0);
}

function commitFromInput(): void {
  if (!activeInput || !activeAnchor) {
    cancelInProgress();
    return;
  }
  const text = activeInput.value.trim();
  removeInput();
  if (!text) {
    activeAnchor = null;
    return;
  }
  const session = getActiveSession();
  if (!session) {
    activeAnchor = null;
    return;
  }
  const ann: TextAnnotation = {
    type: 'text',
    id: makeId(),
    anchor: activeAnchor,
    text,
    color: [...currentColor] as [number, number, number],
    fontSizePx: currentFontSize,
    camera: session.camera,
    plane: session,
  };
  activeAnchor = null;
  addText(ann);
}

function makeId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Programmatic add — used by the console API. Anchor is in world coords.
 *  Camera/plane snapshot uses the *current* viewport state if no annotate
 *  session is active. */
export function addTextAnnotationAtAnchor(opts: {
  anchor: [number, number, number];
  text: string;
  color?: [number, number, number];
  fontSizePx?: number;
}): TextAnnotation {
  // Either reuse the active session or start a transient one for the snapshot.
  let session = getActiveSession();
  let endTransient = false;
  if (!session) {
    session = startSession();
    endTransient = true;
  }
  if (!session) {
    throw new Error('Cannot create text annotation — no viewport state');
  }

  const ann: TextAnnotation = {
    type: 'text',
    id: makeId(),
    anchor: new THREE.Vector3(opts.anchor[0], opts.anchor[1], opts.anchor[2]),
    text: opts.text,
    color: opts.color ?? ([...currentColor] as [number, number, number]),
    fontSizePx: opts.fontSizePx ?? currentFontSize,
    camera: session.camera,
    plane: session,
  };
  addText(ann);
  if (endTransient) endSession();
  return ann;
}
