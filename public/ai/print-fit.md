# Print-Fit helpers — moved (`api.printFit` is deprecated)

The `api.printFit` namespace was split in two. The hardware fits — the metric
fastener table (`fasteners`, `fastener`, `clearance`, `clearanceHole`),
`screwHole`, `tapHole`, `insertBoss`, `nutPocket`, and `clearanceCoupon` — now
live in **`api.fasteners`** (`readDoc("fasteners")`). The part-to-part joinery
— `pin`, `socket`, `dovetail`, `snapFit`, plus the new `hinge`, `ballSocket`,
and `snapRim` — lives in **`api.joints`** (`readDoc("joints")`). `api.printFit.*`
remains available as a frozen, deprecated alias spreading both namespaces, so
old saved sessions keep running — but write new code against `api.fasteners.*`
and `api.joints.*`.
