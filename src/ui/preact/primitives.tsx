// Tiny set of Preact UI primitives — just what the AI Settings pilot
// needs. Deliberately not a full component library: the goal is to
// show the framework's ergonomics on real surfaces before committing
// to broader adoption. Add primitives as the next ported surface
// demands them, not preemptively.

import type { ComponentChildren } from 'preact';

export function Divider() {
  return <hr class="border-zinc-700" />;
}

export function Section(props: { label: string; children: ComponentChildren }) {
  return (
    <div class="flex flex-col gap-2">
      <div class="text-xs text-zinc-400">{props.label}</div>
      {props.children}
    </div>
  );
}

export function Pill(props: {
  active: boolean;
  label: string;
  title?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={props.title}
      disabled={props.disabled}
      class={props.active
        ? 'px-2 py-1 rounded text-[11px] bg-zinc-700 text-zinc-100 border border-zinc-600'
        : 'px-2 py-1 rounded text-[11px] text-zinc-300 border border-zinc-700 hover:bg-zinc-700/60'}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

export function PrimaryButton(props: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  /** EnableRow's button sits inside a flex row, so it uses `shrink-0`
   *  and a gray "disabled" treatment. KeyEntryForm's Connect button sits
   *  inside a flex column, hugs its label via `self-start`, and stays
   *  blue at 50% opacity while validating. The `variant` switches
   *  between those two presentations. */
  variant?: 'row' | 'column';
}) {
  const variant = props.variant ?? 'row';
  const base = 'px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white';
  const layout = variant === 'column' ? 'self-start' : 'shrink-0';
  const disabledStyle = variant === 'column'
    ? 'disabled:opacity-50 disabled:cursor-not-allowed'
    : 'disabled:bg-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed';
  return (
    <button
      type="button"
      class={`${layout} ${base} ${disabledStyle}`}
      disabled={props.disabled}
      title={props.title}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

/** Subdued button. The default `md` size matches the modal footer's
 *  "Done" button; `sm` is the compact variant used inside dense tab
 *  bodies ("Use id", "Load models from your key") so they don't tower
 *  over the small-pill controls beside them. */
export function SecondaryButton(props: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  size?: 'sm' | 'md';
  selfStart?: boolean;
}) {
  const size = props.size ?? 'md';
  const sizing = size === 'sm'
    ? 'px-2 py-1 text-[11px]'
    : 'px-3 py-1.5 text-xs font-medium';
  const layout = props.selfStart ? 'self-start ' : '';
  return (
    <button
      type="button"
      class={`${layout}${sizing} rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-100 disabled:opacity-50`}
      disabled={props.disabled}
      title={props.title}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

export interface TabSpec<T extends string> {
  id: T;
  label: string;
  /** Show the green "Active" pill next to this tab's label. */
  activeBadge?: boolean;
}

export function TabBar<T extends string>(props: {
  tabs: TabSpec<T>[];
  current: T;
  onSelect: (id: T) => void;
}) {
  return (
    <div class="flex border-b border-zinc-700 -mx-1 -mt-1">
      {props.tabs.map(tab => {
        const isViewed = props.current === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            class={isViewed
              ? 'px-4 py-2 text-xs font-medium text-zinc-100 border-b-2 border-blue-500 -mb-px'
              : 'px-4 py-2 text-xs text-zinc-400 hover:text-zinc-200 border-b-2 border-transparent'}
            onClick={() => props.onSelect(tab.id)}
          >
            {tab.label}
            {tab.activeBadge && <ActivePill />}
          </button>
        );
      })}
    </div>
  );
}

function ActivePill() {
  return (
    <span class="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide bg-emerald-900/40 text-emerald-300 border border-emerald-700/50">
      <span class="w-1 h-1 rounded-full bg-emerald-400" />
      Active
    </span>
  );
}
