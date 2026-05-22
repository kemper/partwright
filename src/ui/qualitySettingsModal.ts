// Modeling-quality settings modal — accessible from the toolbar gear.
// Lets users pick the default circular-segment count used by every
// run. Defaults to "Highest" so curves look smooth out of the box;
// users on slower machines can drop to a lower preset, and power users
// can dial in an exact "Custom" segment count.

import { createModalShell } from './modalShell';
import {
  loadQualitySettings,
  saveQualitySettings,
  getDefaultCircularSegments,
  clampCustomSegments,
  QUALITY_OPTIONS,
  MIN_CUSTOM_SEGMENTS,
  MAX_CUSTOM_SEGMENTS,
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
  // Last custom value, preserved while a preset is selected so switching
  // back to Custom restores it.
  let customSegments = current.customSegments;

  const note = document.createElement('p');
  note.className = 'text-xs text-zinc-500 leading-snug';
  const updateNote = () => {
    note.textContent = `Currently using ${getDefaultCircularSegments()} segments per full circle. Changes take effect on the next render.`;
  };

  const group = document.createElement('div');
  group.className = 'flex flex-col gap-2';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Modeling quality preset');

  // --- Custom row controls (defined first so preset handlers can sync
  //     the input's enabled state; appended after the preset rows). -----
  const customRow = document.createElement('label');
  customRow.className =
    'flex items-start gap-3 px-3 py-2 rounded border border-zinc-700 hover:border-zinc-500 cursor-pointer transition-colors';

  const customRadio = document.createElement('input');
  customRadio.type = 'radio';
  customRadio.name = 'quality';
  customRadio.value = 'custom';
  customRadio.checked = current.quality === 'custom';
  customRadio.className = 'mt-1 accent-blue-500';

  const customInput = document.createElement('input');
  customInput.id = 'quality-custom-input';
  customInput.type = 'number';
  customInput.min = String(MIN_CUSTOM_SEGMENTS);
  customInput.max = String(MAX_CUSTOM_SEGMENTS);
  customInput.step = '1';
  customInput.value = String(customSegments);
  customInput.disabled = current.quality !== 'custom';
  customInput.className =
    'w-24 px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-sm text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed focus:border-blue-500 focus:outline-none';

  const syncEnabled = () => {
    customInput.disabled = !customRadio.checked;
  };

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
        saveQualitySettings({ quality: opt.id, customSegments });
        syncEnabled();
        updateNote();
      }
    });
  }

  // --- Assemble + wire the Custom row --------------------------------
  const customText = document.createElement('div');
  customText.className = 'flex flex-col gap-1 flex-1';

  const customLabel = document.createElement('span');
  customLabel.className = 'text-sm font-medium text-zinc-100';
  customLabel.textContent = 'Custom';

  const inputRow = document.createElement('div');
  inputRow.className = 'flex items-center gap-2';
  const segLabel = document.createElement('span');
  segLabel.className = 'text-xs text-zinc-400';
  segLabel.textContent = 'segments per full circle';
  inputRow.appendChild(customInput);
  inputRow.appendChild(segLabel);

  const customHint = document.createElement('span');
  customHint.className = 'text-xs text-zinc-500';
  customHint.textContent = `Any whole number from ${MIN_CUSTOM_SEGMENTS} to ${MAX_CUSTOM_SEGMENTS}.`;

  customText.appendChild(customLabel);
  customText.appendChild(inputRow);
  customText.appendChild(customHint);
  customRow.appendChild(customRadio);
  customRow.appendChild(customText);
  group.appendChild(customRow);

  customRadio.addEventListener('change', () => {
    if (customRadio.checked) {
      saveQualitySettings({ quality: 'custom', customSegments });
      syncEnabled();
      updateNote();
      customInput.focus();
      customInput.select();
    }
  });

  // Persist live while typing (clamped) so the next render uses the value,
  // but leave the field text alone mid-edit to avoid fighting the cursor.
  customInput.addEventListener('input', () => {
    const n = parseInt(customInput.value, 10);
    if (Number.isNaN(n)) return; // empty / partial — wait for blur
    customSegments = clampCustomSegments(n);
    saveQualitySettings({ quality: 'custom', customSegments });
    updateNote();
  });

  // On blur, normalise the field to the stored, clamped integer. A blank /
  // unparseable field falls back to the last good value rather than reset.
  customInput.addEventListener('change', () => {
    const parsed = parseInt(customInput.value, 10);
    customSegments = Number.isNaN(parsed) ? customSegments : clampCustomSegments(parsed);
    customInput.value = String(customSegments);
    saveQualitySettings({ quality: 'custom', customSegments });
    updateNote();
  });

  shell.body.appendChild(group);
  shell.body.appendChild(note);
  updateNote();

  const doneBtn = document.createElement('button');
  doneBtn.className = 'px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white';
  doneBtn.textContent = 'Done';
  doneBtn.addEventListener('click', () => shell.close());
  shell.footer.appendChild(doneBtn);
}
