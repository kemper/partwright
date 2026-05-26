import type { Language } from '../geometry/engines/types';

export interface LanguageBadge {
  /** Short label shown in the badge (`JS` / `SCAD` / `BREP`). */
  label: string;
  /** Tailwind classes for text + border colour. Matches the toolbar pill
   *  colour-coding so a session's badge in the gallery, session bar, and
   *  toolbar all read as the same engine. */
  classes: string;
}

/** One source of truth for the per-language badge label + colour. Consumed by
 *  `sessionBar`, `sessionList`, `landing`, `catalog` — keeping it here means
 *  adding a new language updates every grid/list at once. */
export function languageBadge(language: Language | string | undefined | null): LanguageBadge {
  switch (language) {
    case 'scad':
      return { label: 'SCAD', classes: 'text-amber-400 border-amber-400/30' };
    case 'replicad':
      return { label: 'BREP', classes: 'text-emerald-400 border-emerald-400/30' };
    default:
      return { label: 'JS', classes: 'text-blue-400 border-blue-400/30' };
  }
}
