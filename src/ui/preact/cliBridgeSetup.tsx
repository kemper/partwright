// "Use a Claude or Codex subscription" quick-setup card, shown at the top of
// the Custom (OpenAI-compatible) provider tab.
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
// This card is pure onboarding: copy-paste install/login commands plus a
// one-click "Use this endpoint" that fills the Base URL field below and tests
// it. The connection itself still flows through the existing Custom provider —
// no new provider, transport, or settings are introduced.

import type { ComponentChildren } from 'preact';
import { useSignal } from '@preact/signals';

import { Section, Pill, PrimaryButton } from './primitives';

/** CLIProxyAPI's default OpenAI-compatible base URL. */
const CLI_BRIDGE_ENDPOINT = 'http://localhost:8317/v1';

const REPO_URL = 'https://github.com/router-for-me/CLIProxyAPI';

type OsKey = 'mac' | 'windows' | 'other';

interface InstallSpec {
  label: string;
  /** Steps shown when this OS is selected. The login step is shared and
   *  appended separately. */
  install: { cmd: string; note?: string } | { docs: true };
}

const INSTALL: Record<OsKey, InstallSpec> = {
  mac: {
    label: 'macOS',
    install: {
      cmd: 'brew install cliproxyapi && brew services start cliproxyapi',
      note: 'Installs the bridge and starts it as a background service.',
    },
  },
  windows: {
    label: 'Windows',
    install: {
      cmd: 'winget install LuisPater.CLIProxyAPI',
      note: 'Then run cli-proxy-api in a terminal to start the server.',
    },
  },
  other: {
    label: 'Linux / other',
    install: { docs: true },
  },
};

function detectOs(): OsKey {
  const hay = `${navigator.userAgent} ${navigator.platform ?? ''}`.toLowerCase();
  if (hay.includes('mac')) return 'mac';
  if (hay.includes('win')) return 'windows';
  return 'other';
}

export function CliBridgeSetup(props: { onUseEndpoint: (url: string) => void }) {
  const os = useSignal<OsKey>(detectOs());
  const spec = INSTALL[os.value];

  return (
    <Section label="Use a Claude or Codex subscription">
      <div class="rounded border border-blue-800/40 bg-blue-950/20 px-3 py-3 flex flex-col gap-3">
        <p
          class="text-[11px] text-zinc-300 leading-snug"
          /* eslint-disable-next-line react/no-danger */
          dangerouslySetInnerHTML={{ __html: 'Already pay for a <strong>Claude Pro/Max</strong> (or ChatGPT/Codex) plan? Run <strong><a class="text-blue-400 hover:text-blue-300 underline" href="' + REPO_URL + '" target="_blank" rel="noopener noreferrer">CLIProxyAPI</a></strong> — a small local bridge that turns your subscription into an OpenAI-compatible endpoint on <code>localhost</code>. No API key, no per-token billing. Partwright connects to it as a Custom endpoint.' }}
        />

        <div class="flex flex-wrap gap-1">
          {(Object.keys(INSTALL) as OsKey[]).map(k => (
            <Pill key={k} active={os.value === k} label={INSTALL[k].label} onClick={() => { os.value = k; }} />
          ))}
        </div>

        <Step n={1} title="Install & start the bridge">
          {'docs' in spec.install ? (
            <p class="text-[11px] text-zinc-400 leading-snug">
              Grab a prebuilt binary or the Docker image from the{' '}
              <a class="text-blue-400 hover:text-blue-300 underline" href={REPO_URL} target="_blank" rel="noopener noreferrer">CLIProxyAPI releases</a>, then start it so it listens on port 8317.
            </p>
          ) : (
            <>
              <CopyRow cmd={spec.install.cmd} />
              {spec.install.note && <p class="text-[10px] text-zinc-500">{spec.install.note}</p>}
            </>
          )}
        </Step>

        <Step n={2} title="Log in with your subscription">
          <CopyRow cmd="cliproxyapi --claude-login" />
          <p class="text-[10px] text-zinc-500">
            Opens a browser to authorize your Claude plan. Use <code>--codex-login</code> instead for a ChatGPT/Codex subscription.
          </p>
        </Step>

        <Step n={3} title="Connect Partwright">
          <PrimaryButton
            label="Use this endpoint (localhost:8317)"
            variant="column"
            onClick={() => props.onUseEndpoint(CLI_BRIDGE_ENDPOINT)}
          />
          <p class="text-[10px] text-zinc-500">
            Fills the <strong>Base URL</strong> below and tests it. Then click <strong>Fetch models</strong> and pick a <code>claude-…</code> model.
          </p>
        </Step>

        <div
          class="rounded border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-[11px] text-amber-200 leading-snug"
          /* eslint-disable-next-line react/no-danger */
          dangerouslySetInnerHTML={{ __html: '<strong>Secure it:</strong> the bridge accepts requests from any origin (wildcard CORS). Set an <code>api-key</code> in its <code>config.yaml</code> and paste it into <strong>API key</strong> below, so only requests bearing that key can spend your subscription. Keep it bound to <code>127.0.0.1</code> (the default) — don\'t expose it on your network.' }}
        />

        <p class="text-[10px] text-zinc-500 leading-snug">
          Using a subscription outside its official app is community-supported and not endorsed by Anthropic or OpenAI — confirm it’s allowed under your plan before relying on it.
        </p>
      </div>
    </Section>
  );
}

function Step(props: { n: number; title: string; children: ComponentChildren }) {
  return (
    <div class="flex flex-col gap-1.5">
      <div class="flex items-center gap-2">
        <span class="shrink-0 w-4 h-4 rounded-full bg-blue-700 text-white text-[10px] font-medium flex items-center justify-center">{props.n}</span>
        <span class="text-[11px] font-medium text-zinc-200">{props.title}</span>
      </div>
      <div class="flex flex-col gap-1 pl-6">{props.children}</div>
    </div>
  );
}

function CopyRow(props: { cmd: string }) {
  const label = useSignal('Copy');
  return (
    <div class="flex items-stretch gap-1.5">
      <code class="flex-1 min-w-0 px-2 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-[11px] font-mono text-emerald-200 break-all leading-snug">{props.cmd}</code>
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
  );
}
