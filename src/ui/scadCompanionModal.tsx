// Modal shown when importing a SCAD file that references includes not bundled
// with OpenSCAD's built-in library. Lists the candidate paths and lets the user
// upload a file to satisfy each one before the session is created.
//
// Detection is a two-stage "hybrid" flow: the modal opens immediately listing
// the static regex candidates (every non-BOSL2 `include`/`use` path), then a
// fast OpenSCAD compile probe (`refine`) narrows the list to only the
// dependencies OpenSCAD genuinely can't resolve — anything it finds in its
// bundled libraries collapses to a "✓ resolved" note that needs no action. If
// the probe clears every candidate and the user hasn't attached anything, the
// modal dismisses itself so a file with no real missing deps doesn't interrupt.

import { useState, useRef, useEffect } from 'preact/hooks';
import { mountPreactModal } from './preact/mount';
import { BUTTON_PRIMARY, BUTTON_CANCEL, BUTTON_SMALL_SECONDARY } from './styleConstants';

interface UploadedFile {
  filename: string;
  content: string;
}

/** Does compile-probe result `u` refer to the same file as candidate `c`?
 *  The probe may quote a resolved attempt path while the candidate is the
 *  as-written include path, so we match on basename as well as exact text. */
function sameInclude(c: string, u: string): boolean {
  if (c === u) return true;
  const cb = c.split('/').pop();
  const ub = u.split('/').pop();
  return !!cb && cb === ub;
}

function IncludeRow({ includePath, uploaded, resolved, checking, onUpload }: {
  includePath: string;
  uploaded: UploadedFile | undefined;
  resolved: boolean;
  checking: boolean;
  onUpload: (file: UploadedFile) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div class={`flex items-center gap-2 rounded border px-3 py-2 ${
      resolved
        ? 'bg-zinc-800/30 border-zinc-700/30 opacity-60'
        : 'bg-zinc-800/60 border-zinc-700/50'
    }`}>
      <code class={`flex-1 text-[11px] truncate min-w-0 ${resolved ? 'text-zinc-400 line-through' : 'text-amber-300'}`} title={includePath}>
        {includePath}
      </code>
      {checking && (
        <span class="shrink-0 text-[11px] text-zinc-500">checking…</span>
      )}
      {!checking && resolved && !uploaded && (
        <span class="shrink-0 text-[11px] text-zinc-400 flex items-center gap-1" title="Found in OpenSCAD's bundled libraries — no file needed.">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" class="shrink-0">
            <path d="M1.5 5.5l3 3 5-5" stroke="currentColor" stroke-width="1.5"
              stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          resolved
        </span>
      )}
      {uploaded && (
        <span class="shrink-0 text-[11px] text-green-400 flex items-center gap-1">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" class="shrink-0">
            <path d="M1.5 5.5l3 3 5-5" stroke="currentColor" stroke-width="1.5"
              stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="truncate max-w-[110px]" title={uploaded.filename}>{uploaded.filename}</span>
        </span>
      )}
      {!resolved && (
        <button
          type="button"
          class={`${BUTTON_SMALL_SECONDARY} shrink-0`}
          onClick={() => inputRef.current?.click()}
        >
          {uploaded ? 'Change…' : 'Choose file…'}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".scad"
        class="sr-only"
        onChange={async (e: Event) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (!file) return;
          const content = await file.text();
          onUpload({ filename: file.name, content });
          (e.target as HTMLInputElement).value = '';
        }}
      />
    </div>
  );
}

function ScadCompanionBody({ filename, candidates, refine, onImport }: {
  filename: string;
  candidates: string[];
  refine?: Promise<string[] | null>;
  onImport: (companions: Record<string, string>) => void;
}) {
  const [uploaded, setUploaded] = useState<Record<string, UploadedFile>>({});
  // null while probing; after: a list of genuinely-unresolved paths, or
  // `undefined` (kept distinct) if the probe couldn't run.
  const [unresolved, setUnresolved] = useState<string[] | null | undefined>(refine ? null : undefined);
  const probing = refine ? unresolved === null : false;
  // Track whether the user has touched anything so an auto-dismiss (all deps
  // resolved) never throws away an upload they just made.
  const touched = useRef(false);
  // Guard so the dependency-free auto-dismiss effect fires onImport at most once.
  const dismissed = useRef(false);

  useEffect(() => {
    if (!refine) return;
    let live = true;
    void refine.then(
      (r) => { if (live) setUnresolved(r ?? undefined); },
      () => { if (live) setUnresolved(undefined); },
    );
    return () => { live = false; };
  }, [refine]);

  // A candidate is "resolved" (needs no file) only once the probe has run AND
  // returned a list that doesn't mention it. While probing, or if the probe
  // couldn't run, every candidate stays actionable.
  const isResolved = (c: string): boolean =>
    Array.isArray(unresolved) && !unresolved.some(u => sameInclude(c, u));

  // Extra unresolved paths the probe surfaced that the static scan missed
  // (e.g. a transitive include) — show them as actionable rows too.
  const extraMissing = Array.isArray(unresolved)
    ? unresolved.filter(u => !candidates.some(c => sameInclude(c, u)))
    : [];
  const rows = [...candidates, ...extraMissing];

  const actionable = rows.filter(p => !isResolved(p));

  // Auto-dismiss: probe finished, nothing genuinely missing, user hasn't
  // attached anything → proceed straight to import with no companions.
  useEffect(() => {
    if (Array.isArray(unresolved) && actionable.length === 0 && !touched.current && !dismissed.current) {
      dismissed.current = true;
      onImport({});
    }
  }, [unresolved, actionable.length, onImport]);

  const count = actionable.length;

  return (
    <>
      <p class="text-[11px] text-zinc-400 leading-relaxed">
        <span class="text-zinc-200 font-medium">{filename}</span>{' '}
        {probing
          ? 'references includes outside OpenSCAD’s built-in library. Checking which ones are actually missing…'
          : count === 0
            ? 'has no unresolved includes left to attach.'
            : <>uses {count === 1 ? 'an include' : `${count} includes`} that {count === 1 ? "isn't" : "aren't"} part of OpenSCAD's built-in library. Upload {count === 1 ? 'it' : 'them'} now, or click <em>Import</em> to proceed without {count === 1 ? 'it' : 'them'} — compile errors will appear until {count === 1 ? "it's" : "they're"} added via the companion tab.</>
        }
      </p>
      <div class="flex flex-col gap-1.5 mt-3">
        {rows.map(path => (
          <IncludeRow
            key={path}
            includePath={path}
            uploaded={uploaded[path]}
            resolved={isResolved(path)}
            checking={probing}
            onUpload={f => { touched.current = true; setUploaded(u => ({ ...u, [path]: f })); }}
          />
        ))}
      </div>
      <button
        type="button"
        class={`${BUTTON_PRIMARY} mt-4 w-full`}
        onClick={() => {
          const companions: Record<string, string> = {};
          for (const [path, { content }] of Object.entries(uploaded)) {
            companions[path] = content;
          }
          onImport(companions);
        }}
      >
        Import
      </button>
    </>
  );
}

/**
 * Show a modal that lists SCAD includes the importer couldn't satisfy and lets
 * the user upload files for them. Opens immediately with the static `candidates`
 * (regex-detected non-BOSL2 includes); if `refine` is supplied, its resolution
 * narrows the list to only genuinely-unresolved dependencies. Returns a
 * `path → content` map for supplied companions, or `null` if the user cancelled.
 */
export function showScadCompanionModal(opts: {
  filename: string;
  /** Regex-detected non-BOSL2 include paths — shown immediately. */
  missingIncludes: string[];
  /** Optional compile probe that narrows `missingIncludes` to the genuinely
   *  unresolved subset. Resolving to `null` means the probe couldn't run. */
  refine?: Promise<string[] | null>;
}): Promise<Record<string, string> | null> {
  return new Promise(resolve => {
    let companions: Record<string, string> | null = null;
    mountPreactModal(
      {
        title: `Import ${opts.filename}`,
        onClose: () => resolve(companions),
      },
      close => ({
        body: (
          <ScadCompanionBody
            filename={opts.filename}
            candidates={opts.missingIncludes}
            refine={opts.refine}
            onImport={c => { companions = c; close(); }}
          />
        ),
        footer: (
          <button
            type="button"
            class={BUTTON_CANCEL}
            onClick={() => { companions = null; close(); }}
          >
            Cancel
          </button>
        ),
      }),
    );
  });
}
