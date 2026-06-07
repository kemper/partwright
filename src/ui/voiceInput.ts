// Voice-to-text input via the browser-native Web Speech API
// (SpeechRecognition / webkitSpeechRecognition). No library, no backend, no API
// key: the browser handles capture and transcription. Supported in Chrome,
// Edge, and Safari; absent in Firefox — callers gate the UI on
// `isVoiceInputSupported()` so the mic button only appears where it works.
//
// This module owns the recognition lifecycle (start/stop/toggle, auto-restart
// while the user is still holding the mic open) and emits plain callbacks; the
// consumer (the AI panel) decides where the transcribed text lands.

// The Web Speech API is not in TypeScript's standard DOM lib, so we declare the
// minimal surface we use. These mirror the WHATWG/Web Speech spec shapes.
interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}
interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
  readonly message: string;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: ((event: Event) => void) | null;
  onstart: ((event: Event) => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** True when the browser exposes the Web Speech recognition API. */
export function isVoiceInputSupported(): boolean {
  return getCtor() !== null;
}

export interface VoiceController {
  /** Start if idle, stop if listening. */
  toggle(): void;
  /** Stop listening (commits whatever was transcribed). No-op if idle. */
  stop(): void;
  /** Whether recognition is currently active. */
  isListening(): boolean;
  /** Tear down — aborts any active session and drops listeners. */
  dispose(): void;
}

export interface VoiceControllerOptions {
  /**
   * Fires on every recognition update with the full transcript spoken since
   * this listening session started (final results plus the live interim tail).
   * `isFinal` is true once the session ends and the text is committed.
   */
  onTranscript(transcript: string, isFinal: boolean): void;
  /** Fires when listening starts (true) or stops (false). */
  onStateChange(listening: boolean): void;
  /** Fires on a recognition error with a human-readable message. */
  onError(message: string): void;
  /** BCP-47 language tag. Defaults to the browser locale. */
  lang?: string;
}

// Map the spec's error codes to messages a user can act on.
function errorMessage(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access was blocked. Allow it in your browser to use voice input.';
    case 'no-speech':
      return 'No speech detected. Try again.';
    case 'audio-capture':
      return 'No microphone found.';
    case 'network':
      return 'Voice recognition needs a network connection.';
    case 'aborted':
      return ''; // user-initiated stop — not surfaced
    default:
      return `Voice input error: ${code}`;
  }
}

/**
 * Build a voice-input controller around a single SpeechRecognition instance.
 * Returns null when the API is unavailable (callers should gate on
 * `isVoiceInputSupported()` first and hide the UI entirely).
 */
export function createVoiceController(opts: VoiceControllerOptions): VoiceController | null {
  const Ctor = getCtor();
  if (!Ctor) return null;

  const rec = new Ctor();
  rec.lang = opts.lang ?? navigator.language ?? 'en-US';
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let listening = false;
  // `wantListening` distinguishes a user stop from the engine ending a turn on
  // its own (Chrome stops after a pause even in continuous mode). While the
  // user still wants to dictate, we restart on `onend`.
  let wantListening = false;
  // Final transcript accumulated across auto-restarts within one user session,
  // so chaining restarts doesn't drop earlier sentences.
  let committed = '';

  function emit(interim: string, isFinal: boolean): void {
    const joined = (committed + interim).replace(/\s+/g, ' ').trim();
    opts.onTranscript(joined, isFinal);
  }

  rec.onresult = event => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0]?.transcript ?? '';
      if (result.isFinal) committed += text + ' ';
      else interim += text;
    }
    emit(interim, false);
  };

  rec.onerror = event => {
    const msg = errorMessage(event.error);
    // A blocked/failed permission means we can't recover by restarting.
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed' || event.error === 'audio-capture') {
      wantListening = false;
    }
    if (msg) opts.onError(msg);
  };

  rec.onend = () => {
    if (wantListening) {
      // Engine ended the turn but the user still holds the mic open — restart.
      try {
        rec.start();
        return;
      } catch {
        // Fall through to the stopped state if restart throws (rare).
      }
    }
    listening = false;
    emit('', true);
    opts.onStateChange(false);
  };

  function start(): void {
    if (listening) return;
    committed = '';
    wantListening = true;
    try {
      rec.start();
      listening = true;
      opts.onStateChange(true);
    } catch (err) {
      wantListening = false;
      listening = false;
      opts.onError(err instanceof Error ? err.message : 'Could not start voice input.');
    }
  }

  function stop(): void {
    if (!listening) return;
    wantListening = false;
    rec.stop();
  }

  return {
    toggle() {
      if (listening) stop();
      else start();
    },
    stop,
    isListening: () => listening,
    dispose() {
      wantListening = false;
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      rec.onstart = null;
      try {
        rec.abort();
      } catch {
        // ignore — already stopped
      }
    },
  };
}
