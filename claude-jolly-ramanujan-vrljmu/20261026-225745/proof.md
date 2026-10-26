Several STL and 3MF files picked or dropped at once open one **Import N files** dialog.

| The dialog (2 STL + a 3-object 3MF) | Re-importing: models already in the session start unticked |
|---|---|
| ![modal](multi-file-modal.png) | ![reimport](multi-file-reimport.png) |

| "Everything as one object", arranged in a grid (each model a named part) | Mobile (375 px) |
|---|---|
| ![one object](multi-file-one-object.png) | ![mobile](multi-file-mobile.png) |

**Fix (#1147):** importing into a project while an empty new object is open used to open a new session without asking. Now it asks, and filling the empty object is the default.

| One STL | Several files |
|---|---|
| ![stl](empty-object-stl.png) | ![multi](empty-object-multi.png) |
