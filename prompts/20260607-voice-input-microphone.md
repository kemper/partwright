---
date: 2026-06-07
branch: claude/voice-input-microphone-0uTvd
files_changed:
  - src/ui/voiceInput.ts
  - src/ui/aiPanel.ts
  - tests/ai-voice-input.spec.ts
---

## Human

Add a microphone button to the AI pane so people can click it and do voice-to-text
input for their instructions to the AI. Investigate first: if there's a really
straightforward way for web apps to do this, implement it and open a PR. If it's
tricky — needs a library selection or design decisions — report back and ask
questions instead.

## Assistant

There *is* a straightforward, no-decision path: the browser-native **Web Speech
API** (`SpeechRecognition` / `webkitSpeechRecognition`). No library, no backend,
no API key — the browser captures audio and returns the transcript. It's
supported in Chrome, Edge, and Safari (the Chromium the e2e suite runs on), and
absent in Firefox. Because nothing about it required a library choice or
architectural decision, I implemented it directly per the "go ahead" branch of
the request rather than asking.

Key decisions:

- **New leaf module `src/ui/voiceInput.ts`** owns the recognition lifecycle and
  exposes `isVoiceInputSupported()` + `createVoiceController()`. Keeping it
  separate from `aiPanel.ts` isolates the one place that needs ambient type
  declarations (the Web Speech API isn't in TypeScript's DOM lib) and keeps the
  panel wiring thin. The controller emits plain callbacks
  (`onTranscript`/`onStateChange`/`onError`) so the panel decides where text
  lands.

- **Feature-gated UI.** The mic button (`#btn-ai-mic`, 🎤) only renders when
  `isVoiceInputSupported()` is true, so Firefox users never see a dead button.
  It sits in the input button row beside the existing 📎 attachment button and
  reuses that button's exact Tailwind class for visual consistency; the
  listening state swaps to a red `animate-pulse` variant.

- **Append, don't replace.** On start it anchors the text already in the box and
  appends dictated words to it (with a separator), then dispatches a synthetic
  `input` event so the slash-command menu and other downstream listeners behave
  exactly as for typed text. `continuous` + `interimResults` give live partial
  text; an `onend` auto-restart keeps the session open through Chrome's
  mid-pause stops until the user clicks to stop.

- **Stop on send.** `voiceController?.stop()` runs at the top of both
  `sendMessage` and `queueCurrentInput` so dictation doesn't keep appending to a
  box that's about to be cleared.

- **Errors → `showToast({ variant: 'warn' })`** (auto-mirrored to the Diagnostic
  Log), with spec error codes mapped to actionable messages (blocked mic, no
  speech, no device, network).

- **Language** defaults to `navigator.language`. I deliberately did *not* add an
  appConfig knob: the advanced-settings Field component is numeric-only, and a
  string language picker would be scope creep for a sensible auto-default.

Verified in the browser with a Playwright spec that stubs the Web Speech API
(headless Chromium has no real engine): the mic button renders, dictated text
lands in the textarea appended to existing input, the button reflects the
listening state, and it's hidden entirely when the API is absent.
