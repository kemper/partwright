---
session: "5ecjfq"
timestamp: "2026-11-15T16:26:08Z"
sequence: 10
---

## Human

Proceed with the layer-colour print preview using best judgement; the owner
will test what gets built.

## Assistant

## Key decisions

**What you preview is what the file prints.** A layer-coloured object is
exported as ONE filament (its first band's) plus per-plate filament switches,
with one filament slot per band colour. The measured slicer behaviour is that
layer switches are ignored on a painted object, so when an object has both,
the export leaves its paint out and warns, because the preview shows the
layer colours. Silently writing both would have produced a file that prints
the paint and drops the layer colours.

**Switches are per plate, so a shared plate needs agreement.** The project
file stores layer changes per plate and they only apply when the plate prints
in one filament. A plate gets them only when every object on it declares the
same switches from the same base filament; otherwise they are left out for
that plate with a warning that says to give the object its own plate. The
default layout (one object per plate) never hits this.

**The project slices at the heights the bands were resolved with.** When an
object declares its own layer heights (or the app's setting differs from the
template), the export writes them into the project's print profile. Otherwise
the template's values stand and nothing changes for existing exports. Verified
with a real slice at 0.12 mm layers: 49 layers and switches at exactly the
predicted Z.

**Warnings travel with the result.** The exporter takes an `onWarning`
callback; the UI flow toasts them and the API twins return `warnings`, so an
agent sees the same thing a user does.

**Split pieces drop layer colours.** The heights are measured from the bed and
a split piece sits on its own bed floor, so only whole objects carry them.

**The check tool learned the same facts.** Our 3MF reader now reads the
per-layer file, and `slicer-cli check` counts the slots that layer changes
switch to as filaments the file uses, and adds a `layer-changes` check that
the slicer made exactly the declared number of changes. Where a plate is
painted it warns instead, since the slicer ignores them there. Before this the
tool reported a false failure on every layer-coloured file.

**Checked against the real slicer** through the app's own export: 10 of 10
checks pass and the G-code switches filament at the previewed layers.
