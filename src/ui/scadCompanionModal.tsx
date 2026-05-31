// Modal shown when importing a SCAD file that references includes not bundled
// with OpenSCAD's built-in library. Lists the missing paths and lets the user
// upload a file to satisfy each one before the session is created.

import { useState, useRef } from 'preact/hooks';
import { mountPreactModal } from './preact/mount';
import { BUTTON_PRIMARY, BUTTON_CANCEL, BUTTON_SMALL_SECONDARY } from './styleConstants';

interface UploadedFile {
  filename: string;
  content: string;
}

function IncludeRow({ includePath, uploaded, onUpload }: {
  includePath: string;
  uploaded: UploadedFile | undefined;
  onUpload: (file: UploadedFile) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div class="flex items-center gap-2 rounded bg-zinc-800/60 border border-zinc-700/50 px-3 py-2">
      <code class="flex-1 text-[11px] text-amber-300 truncate min-w-0" title={includePath}>
        {includePath}
      </code>
      {uploaded && (
        <span class="shrink-0 text-[11px] text-green-400 flex items-center gap-1">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" class="shrink-0">
            <path d="M1.5 5.5l3 3 5-5" stroke="currentColor" stroke-width="1.5"
              stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="truncate max-w-[110px]" title={uploaded.filename}>{uploaded.filename}</span>
        </span>
      )}
      <button
        type="button"
        class={`${BUTTON_SMALL_SECONDARY} shrink-0`}
        onClick={() => inputRef.current?.click()}
      >
        {uploaded ? 'Change…' : 'Choose file…'}
      </button>
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

function ScadCompanionBody({ filename, missingIncludes, onImport }: {
  filename: string;
  missingIncludes: string[];
  onImport: (companions: Record<string, string>) => void;
}) {
  const [uploaded, setUploaded] = useState<Record<string, UploadedFile>>({});
  const count = missingIncludes.length;

  return (
    <>
      <p class="text-[11px] text-zinc-400 leading-relaxed">
        <span class="text-zinc-200 font-medium">{filename}</span> uses{' '}
        {count === 1 ? 'an include' : `${count} includes`}{' '}
        that {count === 1 ? "isn't" : "aren't"} part of OpenSCAD's built-in library.
        Upload {count === 1 ? 'it' : 'them'} now, or click <em>Import</em> to proceed without{' '}
        {count === 1 ? 'it' : 'them'} — compile errors will appear until{' '}
        {count === 1 ? "it's" : "they're"} added via the companion tab.
      </p>
      <div class="flex flex-col gap-1.5 mt-3">
        {missingIncludes.map(path => (
          <IncludeRow
            key={path}
            includePath={path}
            uploaded={uploaded[path]}
            onUpload={f => setUploaded(u => ({ ...u, [path]: f }))}
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
 * Show a modal that lists missing SCAD includes and lets the user upload files
 * to satisfy them. Returns a `path → content` map for supplied companions, or
 * `null` if the user cancelled.
 */
export function showScadCompanionModal(opts: {
  filename: string;
  missingIncludes: string[];
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
            missingIncludes={opts.missingIncludes}
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
