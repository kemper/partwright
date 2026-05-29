// Modal shown when importing a mesh (STL) while a session with real content
// is already open. Lets the user choose where the imported geometry should
// land: a new part in the current session (default), merged into the current
// part, or a brand-new session.

import { useEffect, useRef } from 'preact/hooks';
import { mountPreactModal } from './preact/mount';
import { BUTTON_CANCEL } from './styleConstants';

export type ImportTarget = 'new-part' | 'current-part' | 'new-session';

export interface ImportTargetOptions {
  filename: string;
  currentPartName: string | null;
  canAddToCurrent: boolean;
  addDisabledReason?: string;
  recommend?: ImportTarget;
  addReplacesStarter?: boolean;
}

interface Choice {
  target: ImportTarget;
  title: string;
  desc: string;
  recommended: boolean;
  disabled: boolean;
  disabledReason?: string;
}

function buildChoices(opts: ImportTargetOptions): Choice[] {
  const recommend = opts.recommend ?? 'new-part';
  const partLabel = opts.currentPartName ? `"${opts.currentPartName}"` : 'the current part';
  const raw: Omit<Choice, 'recommended'>[] = [
    {
      target: 'new-part',
      title: 'New part',
      desc: 'Add it as a separate part in this session, with its own version history.',
      disabled: false,
    },
    {
      target: 'current-part',
      title: opts.addReplacesStarter ? `Use for current part — ${partLabel}` : `Add to current part — ${partLabel}`,
      desc: opts.addReplacesStarter
        ? 'Make this mesh the contents of the current (empty) part.'
        : 'Combine it with the geometry already in this part (composed as separate components).',
      disabled: !opts.canAddToCurrent,
      disabledReason: opts.addDisabledReason,
    },
    {
      target: 'new-session',
      title: 'New session',
      desc: 'Import into a brand-new session, leaving the current one untouched.',
      disabled: false,
    },
  ];
  return raw.map(c => ({ ...c, recommended: c.target === recommend && !c.disabled }));
}

function ImportTargetBody(props: {
  filename: string;
  choices: Choice[];
  onPick: (target: ImportTarget) => void;
}) {
  const { filename, choices, onPick } = props;
  // Focus the recommended option (falling back to first enabled) so
  // Enter/Space confirms it immediately.
  const recommendedRef = useRef<HTMLButtonElement>(null);
  const firstEnabledRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      (recommendedRef.current ?? firstEnabledRef.current)?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <>
      <p class="text-[11px] text-zinc-400 leading-relaxed">
        Where should <span class="text-zinc-200 font-medium">{filename}</span> go?
      </p>
      {choices.map((c, idx) => {
        const refForButton = c.recommended
          ? recommendedRef
          : (!c.disabled && idx === choices.findIndex(x => !x.disabled))
            ? firstEnabledRef
            : undefined;
        const cls = [
          'w-full text-left rounded-lg border px-3 py-2.5 transition-colors',
          c.disabled
            ? 'border-zinc-800 bg-zinc-800/40 opacity-50 cursor-not-allowed'
            : 'border-zinc-700 hover:border-blue-500 hover:bg-blue-500/10 cursor-pointer',
        ].join(' ');
        return (
          <button
            key={c.target}
            ref={refForButton}
            type="button"
            data-target={c.target}
            disabled={c.disabled}
            class={cls}
            onClick={() => { if (!c.disabled) onPick(c.target); }}
          >
            <div class="flex items-center gap-2">
              <span class="text-sm text-zinc-100 font-medium">{c.title}</span>
              {c.recommended && (
                <span class="text-[9px] uppercase tracking-wide font-semibold text-blue-300 bg-blue-500/20 rounded px-1.5 py-0.5">
                  Default
                </span>
              )}
            </div>
            <div class="text-[11px] text-zinc-400 leading-snug mt-0.5">
              {c.disabled && c.disabledReason ? c.disabledReason : c.desc}
            </div>
          </button>
        );
      })}
    </>
  );
}

export function showImportTargetModal(opts: ImportTargetOptions): Promise<ImportTarget | null> {
  return new Promise(resolve => {
    let result: ImportTarget | null = null;
    const choices = buildChoices(opts);

    mountPreactModal(
      {
        title: 'Import mesh',
        onClose: () => resolve(result),
      },
      close => ({
        body: <ImportTargetBody
          filename={opts.filename}
          choices={choices}
          onPick={target => { result = target; close(); }}
        />,
        footer: (
          <button
            type="button"
            class={BUTTON_CANCEL}
            onClick={() => { result = null; close(); }}
          >Cancel</button>
        ),
      }),
    );
  });
}
