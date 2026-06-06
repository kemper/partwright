// The /ideas page — a discovery surface that answers "what could I even ask
// for?". Unlike the catalog (curated *finished* sessions), each idea is a
// *starting point*: a ready-made prompt you drop into the AI panel, or a
// built-in interactive flow (e.g. photo → voxels) you run on your own input.
//
// Mirrors the structure of src/ui/catalog.ts (theme toggle, back header,
// category sections, tile grid) so the two pages feel like siblings.

import { IDEAS, IDEA_CATEGORIES, type Idea, type IdeaCategoryDef } from '../ideas/ideas';
import { contentHeaderHtml } from '../content/chrome';

export interface IdeasCallbacks {
  onBack: () => void;
  /** A starter/technique idea was chosen — drop its prompt into the AI panel. */
  onUsePrompt: (idea: Idea) => void | Promise<void>;
  /** A "photo → voxels" interactive idea was triggered with a chosen image. */
  onPhotoToVoxel: (file: File) => void | Promise<void>;
  /** A "photo → relief" interactive idea was triggered with a chosen image. */
  onPhotoToRelief: (file: File) => void | Promise<void>;
}

export function createIdeasPage(
  container: HTMLElement,
  callbacks: IdeasCallbacks,
): HTMLElement {
  const page = document.createElement('div');
  page.id = 'ideas-page';
  page.className = 'flex flex-col items-center w-full h-full overflow-auto bg-zinc-900 text-zinc-100';

  // Shared top navigation — identical across every non-editor page. `onBack`
  // is intentionally unused now: the header's logo (home) and nav cover it,
  // matching the landing and the static content pages.
  void callbacks.onBack;
  const headerHost = document.createElement('div');
  headerHost.className = 'w-full';
  headerHost.innerHTML = contentHeaderHtml('/ideas');
  page.appendChild(headerHost);

  const titleWrap = document.createElement('div');
  titleWrap.className = 'w-full max-w-6xl px-6 pt-4';
  titleWrap.innerHTML = '<h1 class="text-3xl font-bold tracking-tight">Ideas</h1>';
  page.appendChild(titleWrap);

  const intro = document.createElement('p');
  intro.className = 'w-full max-w-6xl px-6 mt-2 mb-6 text-sm text-zinc-400 leading-relaxed';
  intro.textContent = 'Not sure what Partwright can do? Start here. Pick a starter prompt to hand the AI, try a technique you didn’t know was possible, or turn one of your own photos into a model. Looking for finished models to remix instead? Browse the Catalog.';
  page.appendChild(intro);

  const body = document.createElement('div');
  body.className = 'w-full max-w-6xl px-6 pb-16';
  page.appendChild(body);

  // Bucket ideas by category, render the non-empty sections in IDEA_CATEGORIES
  // order (entry order within a section follows the dataset).
  const buckets = new Map<string, Idea[]>();
  for (const idea of IDEAS) {
    const arr = buckets.get(idea.category);
    if (arr) arr.push(idea);
    else buckets.set(idea.category, [idea]);
  }

  for (const def of IDEA_CATEGORIES) {
    const ideas = buckets.get(def.id);
    if (!ideas || ideas.length === 0) continue;
    body.appendChild(renderCategorySection(def, ideas, callbacks));
  }

  container.appendChild(page);
  return page;
}

function renderCategorySection(def: IdeaCategoryDef, ideas: Idea[], callbacks: IdeasCallbacks): HTMLElement {
  const section = document.createElement('section');
  section.className = 'mb-10';
  section.dataset.category = def.id;

  const titleRow = document.createElement('div');
  titleRow.className = 'flex items-baseline gap-2';
  const h2 = document.createElement('h2');
  h2.className = 'text-lg font-semibold text-zinc-100';
  h2.textContent = def.title;
  const count = document.createElement('span');
  count.className = 'text-xs text-zinc-500 tabular-nums';
  count.textContent = String(ideas.length);
  titleRow.appendChild(h2);
  titleRow.appendChild(count);
  section.appendChild(titleRow);

  const blurb = document.createElement('p');
  blurb.className = 'text-xs text-zinc-400 mt-0.5 mb-3 leading-relaxed';
  blurb.textContent = def.blurb;
  section.appendChild(blurb);

  const grid = document.createElement('div');
  grid.className = 'grid gap-4';
  grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(240px, 1fr))';
  for (const idea of ideas) grid.appendChild(renderTile(idea, callbacks));
  section.appendChild(grid);

  return section;
}

function renderTile(idea: Idea, callbacks: IdeasCallbacks): HTMLElement {
  // Card wrapper holds the main clickable button plus an optional footer link.
  // (A "learn more" <a> can't nest inside the <button>, hence the wrapper.)
  const card = document.createElement('div');
  card.className = 'flex flex-col bg-zinc-800 rounded-lg border border-zinc-700 hover:border-zinc-500 transition-colors overflow-hidden';
  card.dataset.ideaId = idea.id;

  const btn = document.createElement('button');
  btn.className = 'flex flex-col items-start gap-1.5 text-left px-4 py-3.5 cursor-pointer w-full';

  const top = document.createElement('div');
  top.className = 'flex items-center gap-2';
  const emoji = document.createElement('span');
  emoji.className = 'text-xl leading-none';
  emoji.textContent = idea.emoji;
  const name = document.createElement('div');
  name.className = 'text-sm font-medium text-zinc-100';
  name.textContent = idea.title;
  top.appendChild(emoji);
  top.appendChild(name);
  btn.appendChild(top);

  const desc = document.createElement('div');
  desc.className = 'text-[11px] text-zinc-400 leading-snug';
  desc.textContent = idea.blurb;
  btn.appendChild(desc);

  // Affordance label so it's obvious what a click does.
  const cta = document.createElement('div');
  cta.className = 'text-[10px] font-semibold mt-1';
  if (idea.category === 'interactive') {
    cta.classList.add('text-emerald-300');
    cta.textContent = '\u{1F4F7} Upload a photo →';
  } else {
    cta.classList.add('text-blue-300');
    cta.textContent = '✨ Use this prompt →';
  }
  btn.appendChild(cta);

  card.appendChild(btn);

  if (idea.category === 'interactive' && idea.action) {
    // Hidden file picker per interactive tile.
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.className = 'hidden';
    const action = idea.action;
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      fileInput.value = ''; // allow re-picking the same file later
      if (!file) return;
      if (action === 'photoToVoxel') void callbacks.onPhotoToVoxel(file);
      else if (action === 'photoToRelief') void callbacks.onPhotoToRelief(file);
    });
    card.appendChild(fileInput);
    btn.addEventListener('click', () => fileInput.click());
  } else {
    btn.addEventListener('click', () => { void callbacks.onUsePrompt(idea); });
  }

  // Footer: "learn more" deep-link (opens the reference doc in a new tab).
  if (idea.learnMore) {
    const footer = document.createElement('div');
    footer.className = 'px-4 pb-3 -mt-1';
    const link = document.createElement('a');
    link.href = idea.learnMore;
    link.target = '_blank';
    link.rel = 'noopener';
    link.className = 'text-[10px] text-zinc-500 hover:text-zinc-300 underline decoration-dotted';
    link.textContent = 'Learn how it works →';
    footer.appendChild(link);
    card.appendChild(footer);
  }

  return card;
}
