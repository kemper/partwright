// Building blocks for the CLIProxyAPI ("use a Claude or Codex subscription")
// setup, rendered inside a saved CLIProxyAPI endpoint on the Custom tab
// (customEndpointsTab.tsx).
//
// People who already pay for a Claude Pro/Max (or ChatGPT/Codex) subscription
// can drive Partwright's AI without an API key by running a small, off-the-
// shelf local bridge — CLIProxyAPI — that exposes the subscription's
// authenticated CLI as an OpenAI-compatible endpoint on localhost (default
// :8317). Two properties make it work for a *browser* client where most
// IDE-oriented wrappers don't:
//   - it emits wildcard CORS, so a page on https://www.partwrightstudio.com
//     can fetch it cross-origin (our CSP already allows http://localhost:*);
//   - it supports OpenAI function/tool calling, which Partwright's geometry
//     tools depend on.
//
// The commands themselves (append a key, list keys, log in) are pure and
// live in src/ai/cliProxy.ts.

import type { ComponentChildren } from 'preact';
import { useSignal } from '@preact/signals';

import { CLI_PROXY_REPO_URL, CLI_PROXY_STATUS_URL, type BridgeOs } from '../../ai/cliProxy';
import { Pill } from './primitives';

export const BRIDGE_OS_LABEL: Record<BridgeOs, string> = {
  mac: 'macOS',
  windows: 'Windows',
  other: 'Linux / other',
};

const INSTALL: Record<BridgeOs, { cmd: string; note: string } | null> = {
  mac: { cmd: 'brew install cliproxyapi && brew services start cliproxyapi', note: 'Installs the bridge and starts it as a background service.' },
  windows: { cmd: 'winget install LuisPater.CLIProxyAPI', note: 'Then run cli-proxy-api in a terminal to start the server.' },
  other: null,
};

const LINK = 'text-blue-400 hover:text-blue-300 underline';

export function BridgeIntro() {
  return (
    <p class="text-[11px] text-zinc-300 leading-snug">
      Already pay for a <strong>Claude Pro/Max</strong> (or ChatGPT/Codex) plan? <a class={LINK} href={CLI_PROXY_REPO_URL} target="_blank" rel="noopener noreferrer">CLIProxyAPI</a> is a small bridge that turns your subscription into an OpenAI-compatible endpoint — no per-token billing. Work down the steps; everything you enter is saved with this endpoint.
    </p>
  );
}

export function OsPills(props: { os: BridgeOs; onSelect: (os: BridgeOs) => void }) {
  return (
    <div class="flex flex-wrap gap-1">
      {(Object.keys(BRIDGE_OS_LABEL) as BridgeOs[]).map(k => (
        <Pill key={k} active={props.os === k} label={BRIDGE_OS_LABEL[k]} onClick={() => props.onSelect(k)} />
      ))}
    </div>
  );
}

export function InstallStep(props: { os: BridgeOs }) {
  const spec = INSTALL[props.os];
  return (
    <>
      {spec ? (
        <>
          <CopyRow cmd={spec.cmd} />
          <p class="text-[10px] text-zinc-500">{spec.note}</p>
        </>
      ) : (
        <p class="text-[11px] text-zinc-400 leading-snug">
          Grab a prebuilt binary or the Docker image from the <a class={LINK} href={CLI_PROXY_REPO_URL} target="_blank" rel="noopener noreferrer">CLIProxyAPI releases</a>, then start it so it listens on port 8317.
        </p>
      )}
      <p class="text-[10px] text-zinc-500 leading-snug">
        Open <a class={LINK} href={CLI_PROXY_STATUS_URL} target="_blank" rel="noopener noreferrer">{CLI_PROXY_STATUS_URL}</a> to confirm it’s running, or to see config errors (e.g. <em>“Example API key detected”</em> → do step 2).
      </p>
    </>
  );
}

export function Step(props: { n: number; title: string; done?: boolean; children: ComponentChildren }) {
  return (
    <div class="flex flex-col gap-1.5">
      <div class="flex items-center gap-2">
        <span class={'shrink-0 w-4 h-4 rounded-full text-white text-[10px] font-medium flex items-center justify-center ' + (props.done ? 'bg-emerald-700' : 'bg-blue-700')}>{props.done ? '✓' : props.n}</span>
        <span class="text-[11px] font-medium text-zinc-200">{props.title}</span>
      </div>
      <div class="flex flex-col gap-1.5 pl-6">{props.children}</div>
    </div>
  );
}

/** A command with a Copy button. `summary` shows a short readable stand-in
 *  for a long script (Copy still copies the whole `cmd`), with a toggle to
 *  reveal the full text for anyone who wants to read it before running it. */
export function CopyRow(props: { cmd: string; summary?: string; testId?: string }) {
  const label = useSignal('Copy');
  const full = useSignal(false);
  const shown = props.summary && !full.value ? props.summary : props.cmd;
  return (
    <div class="flex flex-col gap-0.5">
      <div class="flex items-stretch gap-1.5">
        <code data-testid={props.testId} data-command={props.cmd} class="flex-1 min-w-0 px-2 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-[11px] font-mono text-emerald-200 break-all leading-snug">{shown}</code>
        <button
          type="button"
          class="shrink-0 px-2 py-1 rounded text-[11px] bg-zinc-700 hover:bg-zinc-600 text-zinc-100"
          onClick={async () => {
            try { await navigator.clipboard.writeText(props.cmd); label.value = 'Copied!'; }
            catch { label.value = 'Copy failed'; }
            setTimeout(() => { label.value = 'Copy'; }, 1600);
          }}
        >{label.value}</button>
      </div>
      {props.summary && (
        <button type="button" class="self-start text-[10px] text-zinc-500 hover:text-zinc-300 underline" onClick={() => { full.value = !full.value; }}>
          {full.value ? 'Hide the full command' : 'Show the full command'}
        </button>
      )}
    </div>
  );
}
