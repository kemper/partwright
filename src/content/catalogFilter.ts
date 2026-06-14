// Shared, dependency-free catalog filtering behavior. Drives live search plus
// two independent filter facets — a language toggle and a content-theme toggle
// — over already-rendered catalog tiles, by reading a small set of `data-*`
// hooks rather than any app state. Both catalog surfaces emit the same contract
// and call `wireCatalogFilter`:
//   - the static /catalog page (src/content/build/render.ts → catalogEntry.ts)
//   - the in-editor SPA overlay (src/ui/catalog.ts)
//
// Keep this import-free (no app/engine code): catalogEntry.ts deliberately
// ships an empty import graph, so this must stay pure DOM.
//
// Filter semantics (both facets): each pill is an OFF-by-default *selection*.
// An empty selection in a facet means "no constraint" → show everything; once
// any pill in a facet is selected, only tiles matching one of the selected
// values pass that facet. The facets combine with AND (and with search). So all
// pills unselected = the full catalog; selecting one language focuses on it.
//
// Data contract:
//   [data-catalog-search]            — the search <input>
//   [data-catalog-pill="<language>"] — a language toggle button (aria-pressed)
//   [data-catalog-theme="<themeId>"] — a content-theme toggle button (aria-pressed)
//   section[data-category]           — a category section
//     [data-catalog-count]           — element whose text is the visible count
//     [data-catalog-tile]            — a tile, carrying:
//        data-language="<language>"  — its resolved language
//        data-themes="<id id ...>"   — its space-separated theme tags (may be empty)
//        data-search="<haystack>"    — lowercase name + desc + id + label + tags
//   [data-catalog-empty]             — "no results" element (toggled hidden)

/** Classes toggled on a pill to mark it an ACTIVE (selected) filter. */
const PILL_SELECTED_CLASSES = ['ring-2', 'ring-inset', 'ring-teal-400'];
/** Classes toggled on a pill in its default INACTIVE (unselected) state. */
const PILL_UNSELECTED_CLASSES = ['opacity-60'];

/** Wire live search + language/theme filtering over the catalog DOM under
 *  `root`. Idempotent no-op when neither a search box nor pills are present. */
export function wireCatalogFilter(root: ParentNode): void {
  const search = root.querySelector<HTMLInputElement>('[data-catalog-search]');
  const langPills = Array.from(root.querySelectorAll<HTMLElement>('[data-catalog-pill]'));
  const themePills = Array.from(root.querySelectorAll<HTMLElement>('[data-catalog-theme]'));
  const sections = Array.from(root.querySelectorAll<HTMLElement>('section[data-category]'));
  const empty = root.querySelector<HTMLElement>('[data-catalog-empty]');
  if (!search && langPills.length === 0 && themePills.length === 0) return;

  // Selected values per facet. Empty set = "no constraint" (show all).
  const selectedLangs = new Set<string>();
  const selectedThemes = new Set<string>();

  const apply = (): void => {
    const tokens = (search?.value ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    let anyVisible = false;
    for (const section of sections) {
      const tiles = Array.from(section.querySelectorAll<HTMLElement>('[data-catalog-tile]'));
      let visible = 0;
      for (const tile of tiles) {
        const lang = tile.getAttribute('data-language') ?? '';
        const themes = (tile.getAttribute('data-themes') ?? '').split(/\s+/).filter(Boolean);
        const haystack = tile.getAttribute('data-search') ?? '';
        const langOk = selectedLangs.size === 0 || selectedLangs.has(lang);
        const themeOk = selectedThemes.size === 0 || themes.some((t) => selectedThemes.has(t));
        const show = langOk && themeOk && tokens.every((t) => haystack.includes(t));
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

  // The pill count (e.g. "JS 12" / "Figures 30") is the total number of that
  // value in the whole catalog and is intentionally static — it answers "how
  // many of this exist," not "how many currently match." Live match counts live
  // on each section's [data-catalog-count].
  const wireFacet = (pills: HTMLElement[], attr: string, selected: Set<string>, suffix: string): void => {
    const syncPill = (pill: HTMLElement, on: boolean): void => {
      pill.setAttribute('aria-pressed', String(on));
      for (const cls of PILL_SELECTED_CLASSES) pill.classList.toggle(cls, on);
      for (const cls of PILL_UNSELECTED_CLASSES) pill.classList.toggle(cls, !on);
      const label = (pill.textContent ?? '').replace(/\s+\d+$/, '').trim();
      const target = [label, suffix].filter(Boolean).join(' ');
      pill.title = on ? `Showing only ${target} — click to clear` : `Filter to ${target}`;
    };
    // Seed from any pill pre-marked selected in the markup (none, by default).
    for (const pill of pills) {
      const key = pill.getAttribute(attr) ?? '';
      if (key && pill.getAttribute('aria-pressed') === 'true') selected.add(key);
    }
    for (const pill of pills) {
      const key = pill.getAttribute(attr) ?? '';
      syncPill(pill, selected.has(key));
      pill.addEventListener('click', () => {
        if (!key) return;
        if (selected.has(key)) selected.delete(key);
        else selected.add(key);
        syncPill(pill, selected.has(key));
        apply();
      });
    }
  };

  wireFacet(langPills, 'data-catalog-pill', selectedLangs, 'models');
  wireFacet(themePills, 'data-catalog-theme', selectedThemes, '');

  search?.addEventListener('input', apply);
  apply();
}
