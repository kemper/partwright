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
// CLIProxyAPI refuses to start while its config still holds the template
// `your-api-key-N` values, so setting a real key is a *required* step, not a
// nicety. We generate a strong random key in the browser, hand the user a
// one-liner that writes it into the config and restarts the bridge, and offer
// a button to paste that same key into the endpoint's API-key field — so the
// value the proxy expects and the value Partwright sends always match.
//
// This card is pure onboarding: the connection itself still flows through the
// existing Custom provider — no new provider, transport, or settings.

import type { ComponentChildren } from 'preact';
import { useSignal } from '@preact/signals';

import { Section, Pill, PrimaryButton } from './primitives';

/** CLIProxyAPI's default OpenAI-compatible base URL. */
const CLI_BRIDGE_ENDPOINT = 'http://localhost:8317/v1';
/** Where CLIProxyAPI serves its status / config-error page. */
const CLI_BRIDGE_STATUS_URL = 'http://localhost:8317';

const REPO_URL = 'https://github.com/router-for-me/CLIProxyAPI';

/** A strong random API key, generated in the browser. Prefixed so it's
 *  recognizable in a config file; hex body has no shell/sed metacharacters,
 *  so it drops safely into the generated one-liner. */
export function generateApiKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return 'pw-' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

type OsKey = 'mac' | 'windows' | 'other';

interface OsSpec {
  label: string;
  install: { cmd: string; note?: string } | { docs: true };
  /** Writes the API key into the config and restarts the bridge. A runnable
   *  command, or a manual instruction when the path/tooling varies too much
   *  to script reliably. */
  fixAndRestart: (key: string) => { cmd: string } | { manual: string };
}

const OS: Record<OsKey, OsSpec> = {
  mac: {
    label: 'macOS',
    install: {
      cmd: 'brew install cliproxyapi && brew services start cliproxyapi',
      note: 'Installs the bridge and starts it as a background service.',
    },
    fixAndRestart: key => ({
      cmd: `sed -i '' -E "s/your-api-key-[0-9]+/${key}/g" "$(brew --prefix)/etc/cliproxyapi.conf" && brew services restart cliproxyapi`,
    }),
  },
  windows: {
    label: 'Windows',
    install: {
      cmd: 'winget install LuisPater.CLIProxyAPI',
      note: 'Then run cli-proxy-api in a terminal to start the server.',
    },
    fixAndRestart: () => ({
      manual: 'Open the config file named on the status page, replace the three your-api-key-N values with the key above, then stop and re-run cli-proxy-api.',
    }),
  },
  other: {
    label: 'Linux / other',
    install: { docs: true },
    fixAndRestart: key => ({
      cmd: `sed -i -E "s/your-api-key-[0-9]+/${key}/g" <config-path-from-the-status-page>`,
    }),
  },
};

function detectOs(): OsKey {
  const hay = `${navigator.userAgent} ${navigator.platform ?? ''}`.toLowerCase();
  if (hay.includes('mac')) return 'mac';
  if (hay.includes('win')) return 'windows';
  return 'other';
}

export function CliBridgeSetup(props: {
  apiKeyExample: string;
  onUseEndpoint: (url: string) => void;
}) {
  const os = useSignal<OsKey>(detectOs());
  const spec = OS[os.value];
  const fix = spec.fixAndRestart(props.apiKeyExample);

  return (
    <Section label="Use a Claude or Codex subscription">
      <div class="rounded border border-blue-800/40 bg-blue-950/20 px-3 py-3 flex flex-col gap-3">
        <p
          class="text-[11px] text-zinc-300 leading-snug"
          /* eslint-disable-next-line react/no-danger */
          dangerouslySetInnerHTML={{ __html: 'Already pay for a <strong>Claude Pro/Max</strong> (or ChatGPT/Codex) plan? Run <strong><a class="text-blue-400 hover:text-blue-300 underline" href="' + REPO_URL + '" target="_blank" rel="noopener noreferrer">CLIProxyAPI</a></strong> — a small local bridge that turns your subscription into an OpenAI-compatible endpoint on <code>localhost</code>. No per-token billing. Partwright connects to it as a Custom endpoint.' }}
        />

        <div class="flex flex-wrap gap-1">
          {(Object.keys(OS) as OsKey[]).map(k => (
            <Pill key={k} active={os.value === k} label={OS[k].label} onClick={() => { os.value = k; }} />
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
          <p
            class="text-[10px] text-zinc-500 leading-snug"
            /* eslint-disable-next-line react/no-danger */
            dangerouslySetInnerHTML={{ __html: 'Open <a class="text-blue-400 hover:text-blue-300 underline" href="' + CLI_BRIDGE_STATUS_URL + '" target="_blank" rel="noopener noreferrer">' + CLI_BRIDGE_STATUS_URL + '</a> any time to confirm it\'s running — or to see config errors to fix (e.g. <em>"Example API key detected"</em> → do step 2).' }}
          />
        </Step>

        <Step n={2} title="Set an API key (required)">
          <p class="text-[11px] text-zinc-400 leading-snug">
            CLIProxyAPI won’t start while its config holds the template keys. Here’s a fresh random key — this one-liner writes it in and restarts the bridge:
          </p>
          <div class="flex flex-col gap-0.5">
            <span class="text-[10px] text-zinc-500">Your API key (used below too):</span>
            <CopyRow cmd={props.apiKeyExample} />
          </div>
          {'cmd' in fix ? (
            <CopyRow cmd={fix.cmd} />
          ) : (
            <p class="text-[11px] text-amber-200 leading-snug">{fix.manual}</p>
          )}
        </Step>

        <Step n={3} title="Log in with your subscription">
          <CopyRow cmd="cliproxyapi --claude-login" />
          <p class="text-[10px] text-zinc-500">
            Opens a browser to authorize your Claude plan. Use <code>--codex-login</code> instead for a ChatGPT/Codex subscription.
          </p>
        </Step>

        <Step n={4} title="Connect Partwright">
          <PrimaryButton
            label="Use this endpoint (localhost:8317)"
            variant="column"
            onClick={() => props.onUseEndpoint(CLI_BRIDGE_ENDPOINT)}
          />
          <p class="text-[10px] text-zinc-500">
            Fills the <strong>Base URL</strong> below and tests it. Then paste your key with <strong>Use this key</strong> in the API key field, click <strong>Fetch models</strong>, and pick a <code>claude-…</code> model.
          </p>
        </Step>

        <p class="text-[10px] text-zinc-500 leading-snug">
          Keep the bridge bound to <code>127.0.0.1</code> (the default) — don’t expose it on your network. Using a subscription outside its official app is community-supported and not endorsed by Anthropic or OpenAI; confirm it’s allowed under your plan.
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
