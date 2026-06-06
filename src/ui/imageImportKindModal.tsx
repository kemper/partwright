// Chooser shown when an image is imported through the GENERIC import path
// (toolbar "Choose file…" or drag-and-drop), where the user hasn't yet
// expressed an intent. Asks whether to turn the image into a printable
// keychain / tile / relief, or into a colored voxel model. The explicit
// "Image → relief…" / "Image → voxel…" menu items bypass this chooser and go
// straight to their respective flow.

import { useEffect, useRef } from 'preact/hooks';
import { mountPreactModal } from './preact/mount';
import { BUTTON_CANCEL } from './styleConstants';

export type ImageImportKind = 'relief' | 'voxel';

interface Choice {
  kind: ImageImportKind;
  title: string;
  desc: string;
  recommended: boolean;
}

function buildChoices(recommend: ImageImportKind): Choice[] {
  const raw: Omit<Choice, 'recommended'>[] = [
    {
      kind: 'relief',
      title: 'Keychain / tile / relief',
      desc: 'Turn it into a printable colour tile, keychain, sticker, or stepped relief.',
    },
    {
      kind: 'voxel',
      title: 'Voxel model',
      desc: 'Turn it into a colored voxel model — flat billboard or brightness-driven relief.',
    },
  ];
  return raw.map(c => ({ ...c, recommended: c.kind === recommend }));
}

function ImageImportKindBody(props: {
  filename: string;
  choices: Choice[];
  onPick: (kind: ImageImportKind) => void;
}) {
  const { filename, choices, onPick } = props;
  // Focus the recommended option so Enter/Space confirms it immediately.
  const recommendedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => recommendedRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <>
      <p class="text-[11px] text-zinc-400 leading-relaxed">
        How should <span class="text-zinc-200 font-medium">{filename}</span> be imported?
      </p>
      {choices.map(c => (
        <button
          key={c.kind}
          ref={c.recommended ? recommendedRef : undefined}
          type="button"
          data-kind={c.kind}
          class="w-full text-left rounded-lg border px-3 py-2.5 transition-colors border-zinc-700 hover:border-blue-500 hover:bg-blue-500/10 cursor-pointer"
          onClick={() => onPick(c.kind)}
        >
          <div class="flex items-center gap-2">
            <span class="text-sm text-zinc-100 font-medium">{c.title}</span>
            {c.recommended && (
              <span class="text-[9px] uppercase tracking-wide font-semibold text-blue-300 bg-blue-500/20 rounded px-1.5 py-0.5">
                Default
              </span>
            )}
          </div>
          <div class="text-[11px] text-zinc-400 leading-snug mt-0.5">{c.desc}</div>
        </button>
      ))}
    </>
  );
}

/** Ask whether a generically-imported image should become a relief or voxels.
 *  Resolves to the chosen kind, or `null` if the user cancels (so the caller
 *  can abort without mutating any session). */
export function showImageImportKindModal(opts: {
  filename: string;
  recommend?: ImageImportKind;
}): Promise<ImageImportKind | null> {
  return new Promise(resolve => {
    let result: ImageImportKind | null = null;
    const choices = buildChoices(opts.recommend ?? 'voxel');

    mountPreactModal(
      {
        title: 'Import image as…',
        onClose: () => resolve(result),
      },
      close => ({
        body: <ImageImportKindBody
          filename={opts.filename}
          choices={choices}
          onPick={kind => { result = kind; close(); }}
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
