---
session: "01qnzgnp"
timestamp: "2026-10-29T22:50:24Z"
---

## Human

The annotation tool isn't very usable: marks float in space and I end up taking
screen captures to show the AI. It only makes sense if the camera at the moment
of annotating is captured and saved as an annotation angle the agent can look at.
Not sure annotating in space is the right only option; painting on the object
might be harder than marking up the visible frame. What do you think?

(After discussion) Use an explicit button to attach a view to the AI, since people
clear and redo annotations or may not be using the AI yet. Build an annotation
history. Start on: flat markup of the frame, saved views with their camera,
attach + re-render-from-view for the agent, and hit-testing what marks point at.
Keep the floating method as an option.

## Assistant

## Key decisions

**Reuse the session plane instead of a new 2D canvas.** The pen already draws on a
plane perpendicular to the camera, so from the drawing camera the marks are flat.
"Snapshot" style keeps those tools and adds a draft layer: marks drawn while it is
open are drafts that never persist on a version; Save view moves them into a
history entry. This keeps marks re-renderable in 3D from the saved camera.

**Draft scope lives in the annotation store.** One flag scopes every query and
mutation to drafts or floating marks, so overlay, select mode, undo/clear and the
API work in both styles without per-call branching. serializeAll never includes
drafts; a version load keeps them.

**Views are session-level, in their own IndexedDB store (v12) and schema 1.23.**
Saving a view must not require saving a version, and a view spans versions. The
captured JPEG keeps listSessions cheap by staying out of the session record;
share links drop views.

**Hit-testing from the captured camera.** Each mark's screen points (plus a grid
inside closed loops: "circle this") are ray-cast against the current mesh and
mapped to labelled parts, giving the agent "on post, body" without a render.

**Explicit attach, per the user.** A leaf aiComposerBridge lets Annotate stage the
image + a one-line summary in the chat input without importing the AI panel.

**Agent surface kept flat.** listAnnotations (core) now lists views; one new
viewAnnotationView tool sits in the inspect group (fresh: true re-renders the
current model from the saved camera). ai.md got only a row tweak: the system
prompt was 68 chars over its ceiling, so details live in the annotations subdoc.

**Panel width fix.** The Annotate panel grew to ~720px and covered the frame
being marked up; pinned to 288px.
