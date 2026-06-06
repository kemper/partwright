// The filament library moved to the shared colour palette (`src/color/palette.ts`)
// because slots are no longer relief-specific — regular painting assigns regions
// to them too. This module is kept as a thin re-export so existing relief imports
// (`listFilaments`, `hexToRgb`, `DEFAULT_FILAMENTS`, the `Filament` type) keep
// working unchanged.

export * from '../color/palette';
export type { Filament } from '../color/palette';
