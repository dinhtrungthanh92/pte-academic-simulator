// TTS (text-to-speech) for Listening tasks and audio recording for Speaking.

const VOICE_KEY = "pte_voice_name";
const RATE_KEY = "pte_voice_rate";

export function getVoices() {
  return new Promise((resolve) => {
    let voices = speechSynthesis.getVoices();
    if (voices && voices.length) return resolve(voices);
    speechSynthesis.onvoiceschanged = () => resolve(speechSynthesis.getVoices());
  });
}

export async function getEnglishVoices() {
  const all = await getVoices();
  return all.filter((v) => v.lang.startsWith("en"));
}

export function getPreferredVoiceName() {
  return localStorage.getItem(VOICE_KEY) || "";
}

export function setPreferredVoiceName(name) {
  localStorage.setItem(VOICE_KEY, name);
}

export function getRate() {
  return parseFloat(localStorage.getItem(RATE_KEY) || "1.0");
}

export function setRate(r) {
  localStorage.setItem(RATE_KEY, String(r));
}

export async function speak(text, { onEnd, voiceName } = {}) {
  if (!window.speechSynthesis || !text) { onEnd?.(); return; }
  return new Promise(async (resolve) => {
    let settled = false;
    const done = () => { if (settled) return; settled = true; onEnd?.(); resolve(); };
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const voices = await getVoices();
      const preferred = voiceName || getPreferredVoiceName();
      const match = (preferred && voices.find((v) => v.name === preferred)) ||
                    voices.find((v) => v.lang.startsWith("en-AU")) ||
                    voices.find((v) => v.lang.startsWith("en-US")) ||
                    voices.find((v) => v.lang.startsWith("en-GB")) ||
                    voices.find((v) => v.lang.startsWith("en"));
      if (match) u.voice = match;
      u.rate = getRate();
      u.onend = done;
      u.onerror = (e) => { console.warn("Speech error:", e); done(); };
      if (speechSynthesis.paused) speechSynthesis.resume();
      speechSynthesis.speak(u);
      // Safety: never hang if onend never fires (Safari quirk).
      const est = Math.min(20000, Math.max(4000, (text || "").length * 70));
      setTimeout(done, est);
    } catch (e) { console.warn("Speak failed:", e); done(); }
  });
}

export function stopSpeaking() {
  speechSynthesis.cancel();
}

// Play a short "bip" tone that marks the start of the recording window in
// exam/mock-test mode. Needs an AudioContext (created on user gesture path).
export function beep({ freq = 880, durationMs = 250, volume = 0.2 } = {}) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.value = volume;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    setTimeout(() => {
      try { osc.stop(); ctx.close(); } catch (_) {}
    }, durationMs);
  } catch (_) {}
}

// Play a real MP3 audio URL (human voice). Falls back to TTS if it fails.
// Returns a promise that resolves when playback ends (or fails).
let _activeAudio = null;
export function stopAudioUrl() {
  if (_activeAudio) {
    try { _activeAudio.pause(); _activeAudio.currentTime = 0; } catch (_) {}
    _activeAudio = null;
  }
}
export async function playAudioUrl(url, { fallbackText, onEnd } = {}) {
  if (_activeAudio) { try { _activeAudio.pause(); } catch (_) {} _activeAudio = null; }
  if (!url) {
    if (fallbackText) await speak(fallbackText);
    onEnd?.();
    return;
  }
  return new Promise((resolve) => {
    const audio = new Audio(url);
    _activeAudio = audio;
    audio.preload = "auto";
    audio.onended = () => { _activeAudio = null; onEnd?.(); resolve(); };
    audio.onerror = async () => {
      _activeAudio = null;
      console.warn("MP3 failed, falling back to TTS:", url);
      if (fallbackText) await speak(fallbackText);
      onEnd?.();
      resolve();
    };
    audio.play().catch(async () => {
      _activeAudio = null;
      if (fallbackText) await speak(fallbackText);
      onEnd?.();
      resolve();
    });
  });
}

// Returns null if microphone access is available, or an explanatory string
// if it's blocked by the browser context (file://, non-localhost HTTP, etc).
// Use this for pre-flight checks before starting a Speaking task.
export function micUnavailableReason() {
  if (window.isSecureContext === false) {
    return (
      "Your browser is blocking microphone access because the page isn't a secure context. " +
      "Speaking tasks need either HTTPS or http://localhost. " +
      "If you opened the file directly (file://), start a local server instead: " +
      "`cd pte-simulator && python3 -m http.server 8080` and open http://localhost:8080."
    );
  }
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    return (
      "Microphone access is not available in this browser context. " +
      "Make sure you're on http://localhost or HTTPS, and using Chrome / Edge / Brave / Arc. " +
      "Firefox does not support the Speech Recognition API required for transcription."
    );
  }
  return null;
}

// Audio recorder for Speaking tasks. Returns { start, stop, getBlob }.
// Also captures live audio levels so the UI can show a meter.
export async function createRecorder({ onLevel } = {}) {
  const reason = micUnavailableReason();
  if (reason) throw new Error(reason);

  let stream;
  try {
    stream = await Promise.race([
      navigator.mediaDevices.getUserMedia({ audio: true }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("getUserMedia timeout — microphone did not respond. Grant permission and reload.")), 15000)),
    ]);
  } catch (e) {
    if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
      throw new Error(
        "You denied microphone access. To enable it: click the 🔒 icon next to the URL " +
        "in your browser's address bar, set Microphone to 'Allow', and reload the page. " +
        "On macOS also check System Settings → Privacy & Security → Microphone."
      );
    }
    if (e.name === "NotFoundError" || e.name === "DevicesNotFoundError") {
      throw new Error("No microphone detected. Plug one in and reload the page.");
    }
    throw new Error("Could not access the microphone: " + e.message);
  }
  const mr = new MediaRecorder(stream);
  const chunks = [];
  mr.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  // Audio level meter via Web Audio API
  let levelTimer = null;
  if (onLevel) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);
    levelTimer = setInterval(() => {
      analyser.getByteTimeDomainData(buf);
      let max = 0;
      for (const v of buf) max = Math.max(max, Math.abs(v - 128));
      onLevel(max / 128);
    }, 80);
  }

  let blob = null;
  return {
    start() {
      chunks.length = 0;
      mr.start();
    },
    async stop() {
      return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          blob = new Blob(chunks, { type: mr.mimeType || "audio/webm" });
          stream.getTracks().forEach((t) => t.stop());
          if (levelTimer) clearInterval(levelTimer);
          resolve(blob);
        };
        mr.onstop = finish;
        try { mr.stop(); } catch (_) { finish(); return; }
        // Safety: some browsers (older Safari) never fire onstop — don't hang.
        setTimeout(finish, 2500);
      });
    },
    getBlob: () => blob,
    // Immediately release the microphone (stops tracks + recorder) even mid-recording.
    release() {
      try { if (mr.state !== "inactive") mr.stop(); } catch (_) {}
      stream.getTracks().forEach((t) => t.stop());
      if (levelTimer) clearInterval(levelTimer);
    },
  };
}

// Web Speech Recognition (Chrome/Safari) running alongside MediaRecorder.
// Auto-restarts if the engine ends prematurely on silence — Chrome closes
// the session after ~3-5s of no speech, but we want to keep capturing
// until the task explicitly stops.
export function createSpeechRecognizer({ lang = "en-US", onFinal, onInterim } = {}) {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Rec) {
    return {
      start() {},
      stop() {},
      getTranscript: () => "",
      unsupported: true,
    };
  }
  const rec = new Rec();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = lang;

  let finalText = "";
  let interimText = "";
  let shouldKeepRunning = false;
  let lastError = "";

  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) {
        finalText += r[0].transcript + " ";
        onFinal?.(r[0].transcript);
      } else {
        interim += r[0].transcript;
      }
    }
    if (interim) { interimText = interim; onInterim?.(interim); }
  };
  rec.onerror = (e) => {
    lastError = e.error || "";
    // "no-speech" and "aborted" are recoverable — onend will restart.
    if (e.error && e.error !== "no-speech" && e.error !== "aborted") {
      shouldKeepRunning = false;
    }
  };
  rec.onend = () => {
    if (!shouldKeepRunning) return;
    // Restart on next tick to avoid InvalidStateError.
    setTimeout(() => {
      if (shouldKeepRunning) {
        try { rec.start(); } catch (_) {}
      }
    }, 100);
  };

  return {
    start() {
      shouldKeepRunning = true;
      try { rec.start(); } catch (_) {}
    },
    stop() {
      shouldKeepRunning = false;
      try { rec.stop(); } catch (_) {}
    },
    // Prefer final text; fall back to any interim text captured.
    getTranscript: () => (finalText.trim() || interimText.trim()),
    getError: () => lastError,
    unsupported: false,
  };
}
