// Feedback dialog — the in-app "how do I reach the maintainer?" surface.
// Each option is a plain link to GitHub (issue forms or Discussions) opened in
// a new tab; nothing is sent from the app. The bug-report link pre-fills the
// build/browser fields so reports arrive with the version attached.

import { mountPreactModal } from './preact/mount';
import { BUTTON_PRIMARY } from './styleConstants';
import { registerCommands } from './commandPalette';
import { buildInfo } from '../buildInfo';
import {
  bugReportUrl,
  discussionsUrl,
  featureRequestUrl,
  securityReportUrl,
} from '../feedbackLinks';

/** Bug-report link for the page as it is right now (URL is read at call time). */
function currentBugReportUrl(): string {
  return bugReportUrl(buildInfo, {
    href: window.location.href,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
  });
}

interface FeedbackOption {
  id: string;
  icon: string;
  title: string;
  description: string;
  href: string;
}

function feedbackOptions(): FeedbackOption[] {
  return [
    {
      id: 'feedback-bug',
      icon: '🐞',
      title: 'Report a bug',
      description: 'Something broken or behaving oddly. Your version and browser are filled in for you.',
      href: currentBugReportUrl(),
    },
    {
      id: 'feedback-feature',
      icon: '✨',
      title: 'Request a feature',
      description: 'An idea for something Partwright should do, or do better.',
      href: featureRequestUrl(buildInfo),
    },
    {
      id: 'feedback-question',
      icon: '💬',
      title: 'Ask a question',
      description: 'How do I…? Modeling, printing, or the AI assistant.',
      href: discussionsUrl(buildInfo, 'q-a'),
    },
    {
      id: 'feedback-show',
      icon: '🖼️',
      title: 'Share what you made',
      description: 'Show off a model, a print, or a workflow.',
      href: discussionsUrl(buildInfo, 'show-and-tell'),
    },
  ];
}

function FeedbackBody() {
  return (
    <>
      <p class="text-xs text-zinc-400 leading-relaxed">
        Partwright is a small passion project, and feedback of any kind really helps. Each option opens GitHub in a new tab — nothing is sent from here, and you can review everything before posting.
      </p>
      <div class="flex flex-col gap-2">
        {feedbackOptions().map(o => (
          <a
            key={o.id}
            id={o.id}
            href={o.href}
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-start gap-3 rounded-lg border border-zinc-700 bg-zinc-900/40 px-3 py-2.5 hover:border-zinc-500 hover:bg-zinc-800/60 transition-colors"
          >
            <span class="text-lg leading-none mt-0.5" aria-hidden="true">{o.icon}</span>
            <span class="flex flex-col min-w-0">
              <span class="text-sm font-medium text-zinc-100">{o.title} <span class="text-zinc-500">↗</span></span>
              <span class="text-xs text-zinc-400">{o.description}</span>
            </span>
          </a>
        ))}
      </div>
      <p class="text-[11px] text-zinc-500 leading-relaxed">
        Posting needs a free GitHub account. Found a security issue?{' '}
        <a
          href={securityReportUrl(buildInfo)}
          target="_blank"
          rel="noopener noreferrer"
          class="text-blue-400 hover:text-blue-300"
        >Report it privately</a>.
      </p>
    </>
  );
}

export function showFeedbackModal(): void {
  mountPreactModal(
    { title: 'Send feedback' },
    close => ({
      body: <FeedbackBody />,
      footer: (
        <button type="button" class={BUTTON_PRIMARY} onClick={close}>Done</button>
      ),
    }),
  );
}

/** Palette entries for the feedback surfaces. Called once at layout build. */
export function registerFeedbackCommands(): void {
  const open = (href: string) => { window.open(href, '_blank', 'noopener,noreferrer'); };
  registerCommands([
    {
      id: 'feedback.open',
      title: 'Send feedback…',
      hint: 'Help',
      keywords: 'contact support report bug issue github feature request question discussion',
      run: () => showFeedbackModal(),
    },
    {
      id: 'feedback.bug',
      title: 'Report a bug',
      hint: 'Help',
      keywords: 'feedback issue broken github support',
      run: () => open(currentBugReportUrl()),
    },
    {
      id: 'feedback.feature',
      title: 'Request a feature',
      hint: 'Help',
      keywords: 'feedback idea suggestion github',
      run: () => open(featureRequestUrl(buildInfo)),
    },
  ]);
}
