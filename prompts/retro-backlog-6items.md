---
date: 2026-06-12
branch: retro-backlog-6items
files_changed:
  - scripts/build-catalog-entry.cjs
  - tests/unit/apiParity.test.ts
  - public/catalog/bake-manifest.json
  - scripts/new-modifier.mjs
  - package.json
  - src/geometry/voxel/grid.ts
  - tests/unit/voxelFaceComponents.test.ts
  - src/storage/db.ts
  - src/storage/sessionManager.ts
---

## Human

Implement 6 retro backlog items: (1) fix headless:false in build-catalog-entry.cjs,
(2) add partwrightAPI vs help() parity unit test, (3) create bake-manifest.json,
(4) add new:modifier scaffold script, (5) add VoxelGrid.solidifyDiagonals() and
weld() methods, (6) refactor dbSaveVersion to options object.

## Assistant

Six independent housekeeping items implemented in one commit.

Item 1: One-char fix — `headless: false` → `headless: true` at line 126. The
worktree already had the edit staged, matching the intended change.

Item 2: Parity test reads main.ts in latin1 (to handle NUL bytes that binary-
encode cache-key separators). Extracts 4-space-indented members from partwrightAPI
and keys from the help() methods table, then asserts every API member is either
in the help table or in INTENTIONALLY_UNDOCUMENTED. Discovered 12 methods that
are genuinely internal (getModule, setThumbnailCamera, mergeChatHistory, etc.)
and documented them in the set. The test also checks the set for stale entries
to catch the reverse drift.

Item 3: Cross-referenced 122 catalog IDs against the examples/ directory. Found
59 matches using direct name translation (foo-bar → foo_bar.js), the figure_
prefix pattern (waving-kid → figure_waving_kid.js), and manual mappings for
figure variants (karate-master, storytime-reader, etc.) and the sdf-helix-lamp
→ sdf_helix_lamp_standard.js case. All gates set to null/[] per spec.

Item 4: New script takes camelCase name, validates it, generates the typed
TypeScript stub from a template, and prints an 8-item wiring checklist. Exits 1
if file already exists. Wired as "new:modifier" in package.json scripts.

Item 5: weld() uses forEach to iterate other, skips existing cells. 
solidifyDiagonals() iterates the three axis-plane families (XY, XZ, YZ), for
each occupied voxel checks its 4 diagonal neighbours in that plane, and inserts a
bridging voxel at the primary axis direction if neither face-bridge exists.
Repeats until stable. Both return `this` for chaining.

Item 6: Introduced SaveVersionOptions interface, updated saveVersion() to accept
it as the 6th argument. The function body destructures options ?? {} so existing
callers that relied on optional positional args would break at compile time —
caught and fixed all 3 call sites in sessionManager.ts. Each call site's comments
were preserved inline within the options object.
