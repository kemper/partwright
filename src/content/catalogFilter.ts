// Shared, dependency-free catalog filtering behavior. Drives live search + a
// language toggle over already-rendered catalog tiles, by reading a small set
// of `data-*` hooks rather than any app state. Both catalog surfaces emit the
// same contract and call `wireCatalogFilter`:
//   - the static /catalog page (src/content/build/render.ts → catalogEntry.ts)
//   - the in-editor SPA overlay (src/ui/catalog.ts)
//
// Keep this import-free (no app/engine code): catalogEntry.ts deliberately
// ships an empty import graph, so this must stay pure DOM.
//
// Data contract:
//   [data-catalog-search]            — the search <input>
//   [data-catalog-pill="<language>"] — a language toggle button (aria-pressed)
//   section[data-category]           — a category section
//     [data-catalog-count]           — element whose text is the visible count
//     [data-catalog-tile]            — a tile, carrying:
//        data-language="<language>"  — its resolved language
//        data-search="<haystack>"    — lowercase name + desc + id + label
//   [data-catalog-empty]             — "no results" element (toggled hidden)

/** Utility classes toggled on a pill when its language is hidden. Renderer-
 *  agnostic so the same toggle works for the static and runtime pills. */
const PILL_OFF_CLASSES = ['line-through', 'opacity-40'];

/** Wire live search + language filtering over the catalog DOM under `root`.
 *  Idempotent no-op when neither a search box nor pills are present. */
export function wireCatalogFilter(root: ParentNode): void {
  const search = root.querySelector<HTMLInputElement>('[data-catalog-search]');
  const pills = Array.from(root.querySelectorAll<HTMLElement>('[data-catalog-pill]'));
  const sections = Array.from(root.querySelectorAll<HTMLElement>('section[data-category]'));
  const empty = root.querySelector<HTMLElement>('[data-catalog-empty]');
  if (!search && pills.length === 0) return;

  // Languages toggled off. Seeded from any pill already marked off in markup.
  const hidden = new Set<string>();
  for (const pill of pills) {
    if (pill.getAttribute('aria-pressed') === 'false') {
      const lang = pill.getAttribute('data-catalog-pill');
      if (lang) hidden.add(lang);
    }
  }

  const apply = (): void => {
    const tokens = (search?.value ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    let anyVisible = false;
    for (const section of sections) {
      const tiles = Array.from(section.querySelectorAll<HTMLElement>('[data-catalog-tile]'));
      let visible = 0;
      for (const tile of tiles) {
        const lang = tile.getAttribute('data-language') ?? '';
        const haystack = tile.getAttribute('data-search') ?? '';
        const show = !hidden.has(lang) && tokens.every((t) => haystack.includes(t));
        tile.classList.toggle('hidden', !show);
        if (show) visible++;
      }
      const countEl = section.querySelector<HTMLElement>('[data-catalog-count]');
      if (countEl) countEl.textContent = String(visible);
      section.classList.toggle('hidden', visible === 0);
      if (visible > 0) anyVisible = true;
    }
    if (empty) empty.classList.toggle('hidden', anyVisible);
  };

  const syncPill = (pill: HTMLElement, on: boolean): void => {
    pill.setAttribute('aria-pressed', String(on));
    for (const cls of PILL_OFF_CLASSES) pill.classList.toggle(cls, !on);
    const label = (pill.textContent ?? '').replace(/\s+\d+$/, '').trim();
    pill.title = on ? `Hide ${label} models` : `Show ${label} models`;
  };

  search?.addEventListener('input', apply);
  for (const pill of pills) {
    syncPill(pill, !hidden.has(pill.getAttribute('data-catalog-pill') ?? ''));
    pill.addEventListener('click', () => {
      const lang = pill.getAttribute('data-catalog-pill');
      if (!lang) return;
      if (hidden.has(lang)) hidden.delete(lang);
      else hidden.add(lang);
      syncPill(pill, !hidden.has(lang));
      apply();
    });
  }

  apply();
}
