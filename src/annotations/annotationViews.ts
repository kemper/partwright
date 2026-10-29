// Annotation-view history — the in-memory list of saved Snapshot markups for
// the active session, persisted to the `annotationViews` IndexedDB store.
//
// The session manager doesn't own this list (it already imports the annotation
// store, so importing it back would form a cycle): main.ts points it at the
// active session with setAnnotationViewSession() on every session change, and
// the session manager's tab-sync handler calls reloadAnnotationViews() when a
// peer tab edits the same session's history.
//
// Also owns the Annotate *style* — 'snapshot' (draw on a frozen frame, then
// save it as a view) or 'floating' (the original per-version marks on a plane
// in space) — a per-tab preference.

import type { AnnotationView } from './annotationViewTypes';
import {
  putAnnotationView,
  listAnnotationViews as dbListViews,
  deleteAnnotationView as dbDeleteView,
} from '../storage/db';
import { publishTabSync } from '../storage/tabSync';
import { readPerTabPref, writePerTabPref } from '../storage/perTabPref';

export type AnnotateStyle = 'snapshot' | 'floating';

const STYLE_KEY = 'partwright-annotate-style';

let style: AnnotateStyle = readPerTabPref(STYLE_KEY) === 'floating' ? 'floating' : 'snapshot';
const styleListeners: Array<(s: AnnotateStyle) => void> = [];

export function getAnnotateStyle(): AnnotateStyle {
  return style;
}

export function setAnnotateStyle(next: AnnotateStyle): void {
  if (style === next) return;
  style = next;
  writePerTabPref(STYLE_KEY, next);
  for (const fn of styleListeners) fn(next);
}

export function onAnnotateStyleChange(fn: (s: AnnotateStyle) => void): void {
  styleListeners.push(fn);
}

let sessionId: string | null = null;
let views: AnnotationView[] = [];
// Bumped on every session switch so a slow load for a previous session can't
// overwrite the list of the one now open.
let loadSeq = 0;
const listeners: Array<() => void> = [];

function notify(): void {
  for (const fn of listeners) fn();
}

export function onAnnotationViewsChange(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

/** Point the history at a session (null = none) and load its views. */
export async function setAnnotationViewSession(id: string | null): Promise<void> {
  if (id === sessionId) return;
  sessionId = id;
  views = [];
  notify();
  await reload();
}

async function reload(): Promise<void> {
  const seq = ++loadSeq;
  const id = sessionId;
  if (!id) return;
  try {
    const loaded = await dbListViews(id);
    if (seq !== loadSeq || id !== sessionId) return;
    views = loaded;
    notify();
  } catch (err) {
    console.warn('Annotation views: load failed', err);
  }
}

/** Re-read the history after a peer tab changed it. */
export function reloadAnnotationViews(forSession: string): void {
  if (forSession === sessionId) void reload();
}

export function getAnnotationViewSessionId(): string | null {
  return sessionId;
}

/** Saved views, oldest first. */
export function getAnnotationViews(): readonly AnnotationView[] {
  return views;
}

export function getAnnotationView(id: string): AnnotationView | null {
  return views.find(v => v.id === id) ?? null;
}

export function newAnnotationViewId(): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
  return `av_${rand}`;
}

/** Default title for the next view: "View N". */
export function nextViewTitle(): string {
  let n = views.length + 1;
  const titles = new Set(views.map(v => v.title));
  while (titles.has(`View ${n}`)) n++;
  return `View ${n}`;
}

async function persist(view: AnnotationView): Promise<void> {
  await putAnnotationView(view);
  publishTabSync({ kind: 'annotation-views', sessionId: view.sessionId });
}

export async function addAnnotationView(view: AnnotationView): Promise<void> {
  if (view.sessionId === sessionId) {
    views = [...views, view];
    notify();
  }
  await persist(view);
}

export async function updateAnnotationView(id: string, patch: Partial<Pick<AnnotationView, 'title' | 'attachedAt'>>): Promise<AnnotationView | null> {
  const cur = getAnnotationView(id);
  if (!cur) return null;
  const next = { ...cur, ...patch };
  views = views.map(v => (v.id === id ? next : v));
  notify();
  await persist(next);
  return next;
}

export async function deleteAnnotationView(id: string): Promise<boolean> {
  const cur = getAnnotationView(id);
  if (!cur) return false;
  views = views.filter(v => v.id !== id);
  notify();
  await dbDeleteView(id);
  publishTabSync({ kind: 'annotation-views', sessionId: cur.sessionId });
  return true;
}
