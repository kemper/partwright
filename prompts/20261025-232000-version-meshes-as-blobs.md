---
session: "0124MugS7aLdW18UJDeEAS17"
timestamp: "2026-10-25T23:20:00Z"
tools: [playwright]
---

## Human

Go ahead with storing version meshes as Blobs in IndexedDB (the last open
item of #1129). Older builds being unable to read the new records is not a
concern.

## Assistant

**Where the packing lives.** In the storage layer only. `saveVersion` and
`putVersion` swap every typed array of at least `renderer.storedArrayBlobMinKB`
(default 64 KB) for a `{ __pwStoredArray, type, blob }` marker. The version
readers in `db.ts` turn the markers back into the same typed arrays. Callers,
the export path and the session schema never see a Blob, so there is no
`SCHEMA_VERSION` bump: an exported `.partwright.json` is unchanged.

**Generic walk, not named fields.** The codec walks plain objects and arrays,
so import meshes, `parts.triPart`, persisted surface textures and anything
added later are covered without a field list. Containers on the path are
shallow-copied, so the caller's in-memory version keeps its typed arrays.

**Why a size threshold.** A Blob per tiny array would mean many tiny files
in the database. It is a config knob per the repo rule. 0 packs everything,
which the e2e test uses to push a 12-triangle cube down the big-mesh path.

**Back-compat.** Unpacking ignores values without markers, so records saved
before this load unchanged. Records that only move between stores (the
deleted-objects bin, the parts migration, in-place thumbnail/label rewrites)
stay in stored form, which is fine because each one reads and writes the
same record.

**Measured** on a synthetic 3.7M-triangle version (67 MB), with a 5 ms main
thread heartbeat over six alternating rounds:
- save stall: 0.5–1.4 s as typed arrays, ~50 ms as Blobs;
- load stall: 0.37–0.74 s as typed arrays, 0.07–0.28 s as Blobs.

Both are noisy from garbage collection of the dropped arrays.
