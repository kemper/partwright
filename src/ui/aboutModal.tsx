// About dialog — shows which build this page is running so a Cloudflare
// branch or PR preview deploy can be traced back to an exact commit.
// Ported to Preact; mounts into the shared modalShell.

import { useSignal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { mountPreactModal } from './preact/mount';
import { partwrightMarkSvg } from './brand';
import {
  buildInfo,
  shortCommit,
  commitUrl,
  branchUrl,
  pullRequestsUrl,
} from '../buildInfo';

function detectEnvironment(): { label: string; cls: string } {
  const host = window.location.hostname;
  if (host === 'www.partwrightstudio.com' || host === 'partwrightstudio.com') {
    return { label: 'Production', cls: 'text-emerald-400' };
  }
  if (host.endsWith('.pages.dev')) return { label: 'Preview (Cloudflare)', cls: 'text-amber-400' };
  if (host === 'localhost' || host === '127.0.0.1') return { label: 'Local dev', cls: 'text-zinc-300' };
  return { label: host, cls: 'text-zinc-300' };
}

function formatBuildTime(iso: string): { text: string; title: string } {
  if (!iso || iso === 'unknown') return { text: 'unknown', title: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { text: iso, title: iso };
  return { text: d.toLocaleString(), title: iso };
}

function buildInfoText(): string {
  return [
    'Partwright build',
    `branch:  ${buildInfo.branch}`,
    `commit:  ${buildInfo.commit}${buildInfo.dirty ? ' (uncommitted changes)' : ''}`,
    `built:   ${buildInfo.buildTime}`,
    `repo:    ${buildInfo.repo}`,
    `url:     ${window.location.href}`,
  ].join('\n');
}

function ExternalLink(props: { text: string; href: string; mono?: boolean }) {
  return (
    <a
      href={props.href}
      target="_blank"
      rel="noopener noreferrer"
      class={`text-blue-400 hover:text-blue-300 transition-colors break-all${props.mono ? ' font-mono' : ''} text-right text-sm min-w-0`}
    >{props.text}</a>
  );
}

function PlainValue(props: { text: string; title?: string; mono?: boolean }) {
  return (
    <span class={`text-zinc-200 break-all text-right text-sm min-w-0${props.mono ? ' font-mono' : ''}`} title={props.title}>
      {props.text}
    </span>
  );
}

function Row(props: { label: string; children: ComponentChildren }) {
  return (
    <div class="flex items-baseline justify-between gap-4 py-1.5">
      <span class="text-xs text-zinc-500 shrink-0">{props.label}</span>
      {props.children}
    </div>
  );
}

function AboutBody() {
  const env = detectEnvironment();
  const bt = formatBuildTime(buildInfo.buildTime);
  const bUrl = branchUrl(buildInfo);
  const cUrl = commitUrl(buildInfo);
  const sha = shortCommit(buildInfo.commit);
  const prUrl = pullRequestsUrl(buildInfo);

  return (
    <>
      <div class="flex items-center gap-3">
        <div dangerouslySetInnerHTML={{ __html: partwrightMarkSvg(28) }} />
        <div class="flex flex-col">
          <span class="text-sm font-semibold text-zinc-100">Partwright</span>
          <span class="text-xs text-zinc-500">AI-driven parametric CAD</span>
        </div>
      </div>
      <p class="text-xs text-zinc-400 leading-relaxed">
        Which build this page is running. Use it to confirm a Cloudflare branch or PR preview is serving the commit you expect.
      </p>
      <div class="rounded-lg border border-zinc-700 bg-zinc-900/40 px-3 divide-y divide-zinc-800">
        <Row label="Environment">
          <span class={`font-medium text-right text-sm min-w-0 ${env.cls}`}>{env.label}</span>
        </Row>
        <Row label="Branch">
          {bUrl
            ? <ExternalLink text={buildInfo.branch} href={bUrl} mono={true} />
            : <PlainValue text={buildInfo.branch} mono={true} />}
        </Row>
        <Row label="Commit">
          <span class="inline-flex items-center gap-2 justify-end flex-wrap text-right text-sm min-w-0">
            {cUrl
              ? <a id="about-commit" href={cUrl} target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:text-blue-300 transition-colors break-all font-mono">{sha}</a>
              : <span id="about-commit" class="text-zinc-200 break-all font-mono">{sha}</span>}
            {buildInfo.dirty && (
              <span class="text-[9px] uppercase tracking-wide text-amber-400 border border-amber-400/30 rounded px-1 py-px">
                uncommitted
              </span>
            )}
          </span>
        </Row>
        <Row label="Built">
          <PlainValue text={bt.text} title={bt.title} />
        </Row>
      </div>
      {prUrl && (
        <div class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <ExternalLink text="Find the pull request ↗" href={prUrl} />
        </div>
      )}
    </>
  );
}

function AboutFooter(props: { close: () => void }) {
  const copyLabel = useSignal('Copy build info');
  return (
    <>
      <button
        type="button"
        class="px-3 py-1.5 rounded text-xs font-medium bg-zinc-700 hover:bg-zinc-600 text-zinc-100"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(buildInfoText());
            copyLabel.value = 'Copied!';
          } catch {
            copyLabel.value = 'Copy failed';
          }
          setTimeout(() => { copyLabel.value = 'Copy build info'; }, 1600);
        }}
      >{copyLabel.value}</button>
      <button
        type="button"
        class="px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white"
        onClick={props.close}
      >Done</button>
    </>
  );
}

export function showAboutModal(): void {
  mountPreactModal(
    { title: 'About Partwright' },
    close => ({
      body: <AboutBody />,
      footer: <AboutFooter close={close} />,
    }),
  );
}
