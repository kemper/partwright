// Attach-image picker. Replaces the bare file <input> behind the 📎 button
// with a modal that (a) warns when the active model can't see images and
// (b) shows the most recently attached images as one-click re-attach chips.

import { signal, type Signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { mountPreactModal } from './preact/mount';
import { loadSettings } from '../ai/settings';
import { resolveLocalModel } from '../ai/local';
import { fileToImageSource } from '../ai/images';
import {
  attachmentToImageSource,
  deleteAttachment,
  listRecentAttachments,
  type RecentAttachment,
} from '../ai/attachments';
import type { ImageSource } from '../ai/types';

export interface AttachmentModalOptions {
  /** Invoked when the user picks one or more attachments (recent or new). */
  onAttach: (images: ImageSource[]) => void;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function VisionWarning() {
  const settings = loadSettings();
  if (settings.toggles.provider !== 'local' || !settings.toggles.localModel) return null;
  let info;
  try { info = resolveLocalModel(settings.toggles.localModel); } catch { return null; }
  if (info.supportsVision) return null;
  return (
    <div class="px-3 py-2 rounded border border-amber-700 bg-amber-950/40 text-xs text-amber-200 leading-snug">
      <span class="font-semibold">{info.label}</span>{' '}
      can’t see images. Attachments will be silently dropped from the request. Switch to Anthropic in the toggle strip if you need the model to look at this image.
    </div>
  );
}

function AttachmentBody(props: {
  recent: Signal<RecentAttachment[] | null>;
  onAttach: (images: ImageSource[]) => void;
  close: () => void;
}) {
  const { recent, onAttach, close } = props;
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void listRecentAttachments().then(list => { if (!cancelled) recent.value = list; });
    return () => { cancelled = true; };
  }, []);

  async function onFilesPicked(files: FileList | null) {
    if (!files || files.length === 0) return;
    const picked: ImageSource[] = [];
    for (const file of Array.from(files)) {
      const img = await fileToImageSource(file);
      if (img) picked.push(img);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (picked.length > 0) {
      close();
      onAttach(picked);
    }
  }

  async function onDeleteRecent(att: RecentAttachment) {
    await deleteAttachment(att.id);
    recent.value = await listRecentAttachments();
  }

  return (
    <>
      <VisionWarning />
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white"
          onClick={() => fileInputRef.current?.click()}
        >Choose file…</button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          class="hidden"
          onChange={e => { void onFilesPicked((e.currentTarget as HTMLInputElement).files); }}
        />
        <span class="text-xs text-zinc-400">PNG, JPEG, GIF, or WebP.</span>
      </div>
      <h3 class="text-xs uppercase tracking-wider text-zinc-500 font-semibold mt-2">Recent</h3>
      <div class="grid grid-cols-4 gap-2">
        {recent.value === null
          ? <p class="col-span-4 text-xs text-zinc-500 italic">Loading…</p>
          : recent.value.length === 0
            ? <p class="col-span-4 text-xs text-zinc-500 italic">No recent attachments yet. Files you attach will appear here.</p>
            : recent.value.map(att => (
              <div
                key={att.id}
                class="relative group rounded border border-zinc-700 overflow-hidden bg-zinc-900 hover:border-blue-500 cursor-pointer aspect-square"
                title={`${att.label} — ${formatBytes(att.sizeBytes)}\nClick to attach`}
                onClick={() => { close(); onAttach([attachmentToImageSource(att)]); }}
              >
                <img
                  src={`data:${att.mediaType};base64,${att.data}`}
                  class="w-full h-full object-cover"
                  alt={att.label}
                />
                <div class="absolute inset-x-0 bottom-0 px-1.5 py-0.5 bg-black/70 text-white text-[10px] leading-tight truncate">
                  {att.label}
                </div>
                <button
                  type="button"
                  class="absolute top-0.5 right-0.5 w-5 h-5 rounded bg-black/70 text-white text-xs leading-none opacity-0 group-hover:opacity-100 hover:bg-red-600"
                  title={`Remove ${att.label} from recents`}
                  onClick={e => { e.stopPropagation(); void onDeleteRecent(att); }}
                >✕</button>
              </div>
            ))}
      </div>
    </>
  );
}

export function showAttachmentModal(opts: AttachmentModalOptions): void {
  const recent = signal<RecentAttachment[] | null>(null);

  mountPreactModal(
    { title: 'Attach image', maxWidth: 'lg', scrollable: true },
    close => ({
      body: <AttachmentBody recent={recent} onAttach={opts.onAttach} close={close} />,
      footer: (
        <button
          type="button"
          class="px-3 py-1.5 rounded text-xs text-zinc-300 hover:bg-zinc-700"
          onClick={close}
        >Cancel</button>
      ),
    }),
  );
}
