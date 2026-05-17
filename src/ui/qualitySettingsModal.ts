// Modeling-quality settings modal — accessible from the toolbar gear.
// Lets users pick the default circular-segment count used by every
// run. Defaults to "Highest" so curves look smooth out of the box;
// users on slower machines can drop to a lower preset.

import { createModalShell } from './modalShell';
import {
  loadQualitySettings,
  saveQualitySettings,
  QUALITY_OPTIONS,
  QUALITY_SEGMENTS,
  type QualityLevel,
} from '../geometry/qualitySettings';

export function showQualitySettingsModal(): void {
  const shell = createModalShell({ title: 'Modeling Quality' });
  shell.body.classList.remove('gap-3');
  shell.body.classList.add('gap-4');

  const intro = document.createElement('p');
  intro.className = 'text-xs text-zinc-400 leading-relaxed';
  intro.textContent =
    'Controls the default number of segments used to approximate circles, spheres, cylinders, and other curved primitives. Higher values produce smoother curves but slower renders. Scripts can still override per-primitive via the segments argument, or call setCircularSegments() / set $fn directly.';
  shell.body.appendChild(intro);

  const current = loadQualitySettings();

  const group = document.createElement('div');
  group.className = 'flex flex-col gap-2';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Modeling quality preset');

  for (const opt of QUALITY_OPTIONS) {
    const row = document.createElement('label');
    row.className =
      'flex items-start gap-3 px-3 py-2 rounded border border-zinc-700 hover:border-zinc-500 cursor-pointer transition-colors';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'quality';
    radio.value = opt.id;
    radio.checked = opt.id === current.quality;
    radio.className = 'mt-1 accent-blue-500';

    const text = document.createElement('div');
    text.className = 'flex flex-col gap-0.5 flex-1';

    const labelRow = document.createElement('div');
    labelRow.className = 'flex items-center gap-2';

    const label = document.createElement('span');
    label.className = 'text-sm font-medium text-zinc-100';
    label.textContent = opt.label;
    labelRow.appendChild(label);

    if (opt.id === 'highest') {
      const badge = document.createElement('span');
      badge.className =
        'text-[9px] uppercase tracking-wide text-emerald-400 border border-emerald-400/30 rounded px-1 py-px';
      badge.textContent = 'Default';
      labelRow.appendChild(badge);
    }

    const hint = document.createElement('span');
    hint.className = 'text-xs text-zinc-400';
    hint.textContent = opt.hint;

    text.appendChild(labelRow);
    text.appendChild(hint);
    row.appendChild(radio);
    row.appendChild(text);
    group.appendChild(row);

    radio.addEventListener('change', () => {
      if (radio.checked) {
        saveQualitySettings({ quality: opt.id as QualityLevel });
      }
    });
  }
  shell.body.appendChild(group);

  const note = document.createElement('p');
  note.className = 'text-xs text-zinc-500 leading-snug';
  note.textContent = `Currently using ${QUALITY_SEGMENTS[current.quality]} segments per full circle. Changes take effect on the next render.`;
  shell.body.appendChild(note);

  const doneBtn = document.createElement('button');
  doneBtn.className = 'px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white';
  doneBtn.textContent = 'Done';
  doneBtn.addEventListener('click', () => shell.close());
  shell.footer.appendChild(doneBtn);
}
