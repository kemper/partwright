// Modal shown when importing a mesh (STL) while a session with real content
// is already open. Lets the user choose where the imported geometry should
// land: a new part in the current session (default), merged into the current
// part, or a brand-new session.

import { useEffect, useRef, useState } from 'preact/hooks';
import { mountPreactModal } from './preact/mount';
import { BUTTON_CANCEL } from './styleConstants';

export type ImportTarget = 'new-part' | 'current-part' | 'new-session' | 'companion-file';

export interface ImportTargetOptions {
  filename: string;
  currentPartName: string | null;
  canAddToCurrent: boolean;
  addDisabledReason?: string;
  recommend?: ImportTarget;
  addReplacesStarter?: boolean;
  /** Override title text for the 'current-part' choice (e.g. for code imports). */
  currentPartTitle?: string;
  /** Override description text for the 'current-part' choice. */
  currentPartDesc?: string;
  /** When set, offers a fourth choice: attach the imported SCAD file as a
   *  companion of the current part rather than treating it as part code. Only
   *  meaningful for a .scad import while the current part is a SCAD session. */
  canAddAsCompanion?: boolean;
  /** Override title text for the 'companion-file' choice. */
  companionTitle?: string;
  /** Override description text for the 'companion-file' choice. */
  companionDesc?: string;
  /** Modal heading. Defaults to "Import mesh"; image/voxel/BREP imports pass a
   *  noun-appropriate title (e.g. "Import voxels", "Import STEP"). */
  title?: string;
  /** The session's objects: "Add to object" then offers a picker (default:
   *  the current one) and adds the import as named parts of the one picked. */
  objects?: { id: string; name: string }[];
  currentObjectId?: string;
}

/** The choice, plus the object picked for "Add to object". */
export interface ImportTargetPick {
  target: ImportTarget;
  objectId?: string;
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
  const partLabel = opts.currentPartName ? `"${opts.currentPartName}"` : 'the current object';
  const raw: Omit<Choice, 'recommended'>[] = [
    {
      target: 'new-part',
      title: 'New object',
      desc: 'Add it as a separate object in this session, with its own version history.',
      disabled: false,
    },
    {
      target: 'current-part',
      title: opts.currentPartTitle ?? (opts.addReplacesStarter ? `Use for current object — ${partLabel}` : `Add to current object — ${partLabel}`),
      desc: opts.currentPartDesc ?? (opts.addReplacesStarter
        ? 'Make the import the contents of the current object, which is still empty.'
        : 'Combine it with the geometry already in this object (composed as separate pieces).'),
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
  if (opts.canAddAsCompanion) {
    raw.push({
      target: 'companion-file',
      title: opts.companionTitle ?? `Companion file of current object — ${partLabel}`,
      desc: opts.companionDesc ?? `Attach it as a dependency the current object's code can include <…> — it won't replace your code.`,
      disabled: false,
    });
  }
  return raw.map(c => ({ ...c, recommended: c.target === recommend && !c.disabled }));
}

function ImportTargetBody(props: {
  filename: string;
  choices: Choice[];
  objects?: { id: string; name: string }[];
  currentObjectId?: string;
  onPick: (pick: ImportTargetPick) => void;
}) {
  const { filename, choices, objects } = props;
  const [objectId, setObjectId] = useState(props.currentObjectId ?? objects?.[0]?.id ?? '');
  const picked = objects?.find(o => o.id === objectId);
  const onPick = (target: ImportTarget) => props.onPick(target === 'current-part' && objects ? { target, objectId } : { target });
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
              <span class="text-sm text-zinc-100 font-medium">{c.target === 'current-part' && picked ? `Add to object — "${picked.name}"` : c.title}</span>
              {c.recommended && (
                <span class="text-[9px] uppercase tracking-wide font-semibold text-blue-300 bg-blue-500/20 rounded px-1.5 py-0.5">
                  Default
                </span>
              )}
            </div>
            <div class="text-[11px] text-zinc-400 leading-snug mt-0.5">
              {c.disabled && c.disabledReason ? c.disabledReason : c.target === 'current-part' && picked
                ? 'Becomes a named part of that object, placed beside its geometry. A JavaScript object keeps its code; arrange the parts with the Parts panel.'
                : c.desc}
            </div>
          </button>
        );
      })}
      {objects && objects.length > 1 && !choices.find(c => c.target === 'current-part')?.disabled && (
        <label class="flex items-center gap-2 text-[11px] text-zinc-400 -mt-1 pl-1">
          Add to object
          <select
            data-import-object
            class="flex-1 min-w-0 min-h-[44px] md:min-h-0 px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 text-[11px]"
            value={objectId}
            onChange={e => setObjectId((e.target as HTMLSelectElement).value)}
          >
            {objects.map(o => <option key={o.id} value={o.id}>{o.name}{o.id === props.currentObjectId ? ' (open)' : ''}</option>)}
          </select>
        </label>
      )}
    </>
  );
}

export async function showImportTargetModal(opts: ImportTargetOptions): Promise<ImportTarget | null> {
  return (await pickImportTarget(opts))?.target ?? null;
}

/** showImportTargetModal, with the object picked for "Add to object" (when
 *  `opts.objects` is given). */
export function pickImportTarget(opts: ImportTargetOptions): Promise<ImportTargetPick | null> {
  return new Promise(resolve => {
    let result: ImportTargetPick | null = null;
    const choices = buildChoices(opts);

    mountPreactModal(
      {
        title: opts.title ?? 'Import mesh',
        onClose: () => resolve(result),
      },
      close => ({
        body: <ImportTargetBody
          filename={opts.filename}
          choices={choices}
          objects={opts.addReplacesStarter ? undefined : opts.objects}
          currentObjectId={opts.currentObjectId}
          onPick={pick => { result = pick; close(); }}
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
