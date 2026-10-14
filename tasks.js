// Renderers for all 20 PTE task types. Each renderer is an async function
// `render(host, item)` that mounts UI into `host` (a DOM element) and resolves
// with the candidate's response payload. app.js handles scoring & result display.

import { CONTENT, getTaskMeta, randomItem } from "./content.js";
import { getGeneratedFor } from "./generation.js";
import {
  speak,
  playAudioUrl,
  stopAudioUrl,
  beep,
  stopSpeaking,
  createRecorder,
  createSpeechRecognizer,
} from "./audio.js";
import { renderChart, describeChartData } from "./chart.js";
import {
  explainFillBlank,
  explainMCQ,
  explainReorder,
  explainWFD,
  explainHIW,
  explainASQ,
  explainListeningFIB,
} from "./explain.js";
import {
  scoreReadAloud,
  scoreRepeatSentence,
  scoreDescribeImage,
  scoreRetellLecture,
  scoreAnswerShortQuestion,
  scoreSummarizeWrittenText,
  scoreEssay,
  scoreSummarizeSpokenText,
  scoreMCMA,
  scoreMCSA,
  scoreReorder,
  scoreFillBlanks,
  scoreWriteFromDictation,
  scoreHighlightIncorrectWords,
} from "./scoring.js";

// ----------------- shared helpers -----------------

export function setTopbarTimer(secondsRemaining) {
  const el = document.getElementById("timer");
  if (!el) return;
  if (secondsRemaining == null) {
    el.textContent = "";
    el.classList.remove("warn");
    return;
  }
  const m = Math.floor(secondsRemaining / 60);
  const s = Math.floor(secondsRemaining % 60);
  el.textContent = `${m}:${s.toString().padStart(2, "0")}`;
  el.classList.toggle("warn", secondsRemaining <= 10);
}

export function setTaskLabel(text) {
  const el = document.getElementById("task-label");
  if (el) el.textContent = text || "";
}

function clearTimer() { setTopbarTimer(null); }

function escapeHtml(s) {
  return String(s).replace(/[<>&"]/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;",
  }[c]));
}

function wordCount(s) {
  return (s || "").trim().split(/\s+/).filter(Boolean).length;
}

// Merge AI-generated items into the random pool for a given task type.
function pool(taskId, baseArray) {
  const generated = getGeneratedFor(taskId);
  let arr = generated.length ? [...baseArray, ...generated] : baseArray;
  if (localStorage.getItem("pte_only_repeated") === "1") {
    const rep = arr.filter((it) => it && it.repeated === true);
    if (rep.length > 0) arr = rep;
  }
  return arr;
}

// One-shot injection: when set, the next pick() for that taskId uses
// the injected item and then clears it. Lets the "Generate & practise"
// flow guarantee the user gets the freshly-generated item.
const injected = {};
export function injectItem(taskId, item) {
  injected[taskId] = item;
}
// Session seen items cache to prevent repeating until pool is exhausted
const sessionPools = {};
function pick(taskId, baseArray) {
  if (injected[taskId]) {
    const it = injected[taskId];
    delete injected[taskId];
    return it;
  }
  const currentPool = pool(taskId, baseArray);
  if (!sessionPools[taskId] || sessionPools[taskId].length === 0) {
    // Shuffle a fresh copy of the pool
    sessionPools[taskId] = [...currentPool].sort(() => Math.random() - 0.5);
  }
  return sessionPools[taskId].pop();
}

// The single in-flight countdown, exposed via abortActiveTask so the topbar
// "Exit" / "Home" buttons can stop it cleanly. Without this, an old
// countdown keeps writing to #timer after the user has navigated away,
// making the topbar timer appear "stuck" or carry over to the next task.
let activeCountdown = null;

function countdown(seconds, onTick) {
  let cancelled = false;
  const start = performance.now();
  const promise = new Promise((resolve) => {
    function step() {
      if (cancelled) return resolve("cancel");
      const elapsed = (performance.now() - start) / 1000;
      const remaining = Math.max(0, seconds - elapsed);
      onTick?.(remaining);
      setTopbarTimer(remaining);
      if (remaining <= 0) return resolve("done");
      requestAnimationFrame(step);
    }
    step();
  });
  const handle = {
    promise,
    cancel: () => {
      cancelled = true;
      if (activeCountdown === handle) activeCountdown = null;
    },
  };
  activeCountdown = handle;
  return handle;
}

// Called by app.js when the user exits a task / examination mid-way.
// Cancels the running countdown, clears the topbar timer, and stops any
// TTS playback so the home page lands in a clean state.
export function abortActiveTask() {
  if (activeCountdown) {
    activeCountdown.cancel();
    activeCountdown = null;
  }
  setTopbarTimer(null);
  setTaskLabel("");
  stopSpeaking();
  stopAudioUrl();
  // Stop and release microphone tracks completely
  try {
    if (activeRecorder) {
      if (activeRecorder.stream) {
        activeRecorder.stream.getTracks().forEach((t) => t.stop());
      }
      activeRecorder.stop?.();
      activeRecorder.release?.();
    }
  } catch (_) {}
  try { activeRecognizer?.stop?.(); } catch (_) {}
  activeRecorder = null;
  activeRecognizer = null;
}

// The recorder/recognizer for the in-flight speaking task, so abortActiveTask
// (Home / Back / Exit) can shut the microphone down immediately.
let activeRecorder = null;
let activeRecognizer = null;

// Generic speaking-task flow: prep phase (display only), then recording phase.
async function runSpeakingFlow({
  host,
  prepSeconds,
  recordSeconds,
  contentHTML,
  recordingExtraHTML = "",
  speakBefore = null, // async function called before recording (e.g. play lecture)
  manualRecord = false, // when true: mic opens only on button press, stops only on button press
  examFlow = false, // when true: audio -> beep -> mic auto-opens -> countdown -> Finish/Stop button
  answerForReview = null, // when set, show this correct answer right after recording stops
}) {
  host.innerHTML = `
    <div class="panel task-content">
      <div class="instruction" id="phase-msg">Prepare to respond. Recording will start automatically.</div>
      <div id="task-body">${contentHTML}</div>
      <div class="recorder">
        <div class="row">
          <span class="rec-indicator" id="rec-dot"></span>
          <span id="rec-status">Waiting…</span>
          <span class="spacer"></span>
          <button class="secondary" id="finish-btn" disabled>Finish early</button>
        </div>
        <div class="audio-level"><div class="audio-level-bar" id="level"></div></div>
        ${recordingExtraHTML}
      </div>
      <div class="row" style="margin-top:16px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.08); display:flex; justify-content:flex-end;">
        <button class="primary next-question-global" type="button" style="font-weight:700;">⏩ Câu tiếp theo</button>
      </div>
      <p class="small muted" style="margin-top:8px;">Tip: speak clearly into your microphone. Speech is transcribed using your browser's recognition API.</p>
    </div>
  `;

  const phaseMsg = host.querySelector("#phase-msg");
  const recStatus = host.querySelector("#rec-status");
  const recDot = host.querySelector("#rec-dot");
  const finishBtn = host.querySelector("#finish-btn");
  const levelBar = host.querySelector("#level");

  // Global nav buttons inside speaking flow
  host.querySelector(".next-question-global")?.addEventListener("click", () => {
    abortActiveTask();
    document.dispatchEvent(new CustomEvent("pte:next_task"));
  });

  if (speakBefore) {
    phaseMsg.textContent = "Listen carefully…";
    await speakBefore();
  }

  // Prep phase (auto mode only; examFlow handles its own prep)
  if (prepSeconds > 0 && !examFlow) {
    phaseMsg.textContent = `Preparation: ${prepSeconds}s. Recording starts when this ends.`;
    const cd = countdown(prepSeconds);
    await cd.promise;
  }

  let recorder, recognizer;
  let liveTransEl = null;
  const ensureRecorder = async () => {
    if (recorder) return;
    recorder = await createRecorder({
      onLevel: (l) => {
        levelBar.style.width = `${Math.min(100, l * 200)}%`;
      },
    });
    activeRecorder = recorder;
    recognizer = createSpeechRecognizer({
      lang: "en-US",
      onInterim: (t) => { if (liveTransEl) liveTransEl.textContent = t; },
      onFinal: (t) => { if (liveTransEl) liveTransEl.textContent = (liveTransEl.dataset.all || "") + " " + t; liveTransEl.dataset.all = liveTransEl.textContent; },
    });
    activeRecognizer = recognizer;
  };

  // Live transcript panel shown during recording (helps Read Aloud etc.)
  function ensureLiveTranscript() {
    if (host.querySelector("#live-transcript")) { liveTransEl = host.querySelector("#live-transcript"); return; }
    const w = document.createElement("div");
    w.className = "live-transcript";
    w.innerHTML = `<div class="lt-label">🎙️ Nhận dạng giọng nói (trực tiếp)</div><div id="live-transcript" class="lt-text"></div>`;
    host.querySelector(".recorder")?.appendChild(w);
    liveTransEl = w.querySelector("#live-transcript");
  }

  // ---- Exam flow: [prep] -> beep -> mic auto-opens -> countdown + Finish button ----
  if (examFlow) {
    // 1. Optional preparation countdown (Read Aloud / Describe Image)
    if (prepSeconds > 0) {
      phaseMsg.textContent = `📖 Chuẩn bị: ${prepSeconds}s. Thu âm sẽ bắt đầu sau tiếng bip.`;
      const prepCd = countdown(prepSeconds);
      await prepCd.promise;
      clearTimer();
    }

    // 2. Bip before the recording window opens
    phaseMsg.textContent = "🔔 Chuẩn bị... thu âm bắt đầu sau tiếng bip.";
    beep({ freq: 880, durationMs: 250 });
    await new Promise((r) => setTimeout(r, 700));

    // 2. Open the microphone automatically (exam-style)
    try {
      await ensureRecorder();
    } catch (e) {
      phaseMsg.textContent = "";
      host.innerHTML += `<div class="error">Không truy cập được micro. Hãy cho phép quyền micro (cần HTTPS hoặc localhost) rồi thử lại.</div>`;
      throw e;
    }
    recorder.start();
    recognizer.start();
    ensureLiveTranscript();
    recDot.classList.add("recording");

    // 3. Countdown display + Finish button
    host.querySelector("#rec-status").textContent = "Recording…";
    const timerEl = document.createElement("span");
    timerEl.id = "rec-timer";
    timerEl.style.cssText = "margin-left:12px; font-variant-numeric: tabular-nums; font-weight:600; color:#dc2626;";
    finishBtn.parentNode.insertBefore(timerEl, finishBtn);
    finishBtn.textContent = "⏹ Kết thúc";
    finishBtn.disabled = false;

    const startTime = Date.now();
    const cd = countdown(recordSeconds);
    const tick = setInterval(() => {
      const remaining = Math.max(0, recordSeconds - Math.round((Date.now() - startTime) / 1000));
      timerEl.textContent = `⏱ ${remaining}s`;
      if (remaining <= 0) clearInterval(tick);
    }, 200);
    phaseMsg.textContent = "🎤 Đang thu âm. Bấm 'Kết thúc' khi nói xong.";

    let earlyFinish = false;
    const doFinish = () => { earlyFinish = true; cd.cancel(); };
    finishBtn.addEventListener("click", doFinish);

    await cd.promise;
    clearInterval(tick);
    clearTimer();
    recDot.classList.remove("recording");
    recStatus.textContent = "Processing…";
    let blob = null, rawTranscript = "";
    try { blob = await recorder.stop(); } catch (e) { console.warn("recorder.stop failed:", e); }
    try { recognizer.stop(); } catch (_) {}
    await new Promise((r) => setTimeout(r, 300));
    try { rawTranscript = recognizer.getTranscript() || ""; } catch (_) {}
    recStatus.textContent = "Done.";
    const review = await reviewTranscriptStep(host, blob, rawTranscript, answerForReview);
    return { blob, transcript: review.transcript, rawTranscript, earlyFinish, nextRequested: review.action === 'next' };
  }

  // ---- Manual mode: mic opens only on click, stops on click ----
  if (manualRecord) {
    phaseMsg.textContent = "Bấm nút bên dưới để bắt đầu thu âm.";
    recStatus.textContent = "Sẵn sàng";
    const btn = document.createElement("button");
    btn.className = "primary";
    btn.id = "record-toggle";
    btn.textContent = "🎤 Bắt đầu thu âm";
    btn.style.cssText = "margin-top:10px; padding:12px 22px; font-size:15px;";
    host.querySelector(".recorder").appendChild(btn);

    return await new Promise((resolve, reject) => {
      let recording = false;
      btn.addEventListener("click", async () => {
        if (!recording) {
          // START
          try {
            await ensureRecorder();
          } catch (e) {
            host.innerHTML += `<div class="error">Microphone access denied. Please allow microphone access (needs HTTPS or localhost) and try again.</div>`;
            reject(e);
            return;
          }
          recorder.start();
          recognizer.start();
          recording = true;
          recDot.classList.add("recording");
          recStatus.textContent = "Recording…";
          phaseMsg.textContent = "🎤 Đang thu âm. Bấm nút để dừng.";
          btn.textContent = "⏹ Dừng thu âm";
          btn.style.background = "#dc2626";
        } else {
          // STOP
          recording = false;
          btn.disabled = true;
          recDot.classList.remove("recording");
          recStatus.textContent = "Processing…";
          phaseMsg.textContent = "Đã dừng thu âm.";
          clearTimer();
          const blob = await recorder.stop();
          recognizer.stop();
          await new Promise((r) => setTimeout(r, 300));
          const rawTranscript = recognizer.getTranscript();
          recStatus.textContent = "Done.";
          const review = await reviewTranscriptStep(host, blob, rawTranscript, answerForReview);
          resolve({ blob, transcript: review.transcript, rawTranscript, earlyFinish: false, nextRequested: review.action === 'next' });
        }
      });
    });
  }

  // ---- Auto mode (default) ----
  phaseMsg.textContent = "Get ready to speak…";
  await new Promise((r) => setTimeout(r, 1200));

  try {
    await ensureRecorder();
  } catch (e) {
    phaseMsg.textContent = "";
    host.innerHTML += `<div class="error">Microphone access denied. Please allow microphone access (needs HTTPS or localhost) and try again.</div>`;
    throw e;
  }

  recorder.start();
  recognizer.start();
  recDot.classList.add("recording");
  recStatus.textContent = "Recording…";
  finishBtn.disabled = false;
  phaseMsg.textContent = "🎤 Speak now.";

  const cd = countdown(recordSeconds);
  let earlyFinish = false;
  finishBtn.addEventListener("click", () => {
    earlyFinish = true;
    cd.cancel();
  });

  await cd.promise;
  clearTimer();
  recDot.classList.remove("recording");
  recStatus.textContent = "Processing…";
  const blob = await recorder.stop();
  recognizer.stop();
  await new Promise((r) => setTimeout(r, 300)); // let final speech result settle
  const rawTranscript = recognizer.getTranscript();
  recStatus.textContent = "Done.";

  // Edit step: let the user listen back, fix recognizer mistakes, then submit.
  const review = await reviewTranscriptStep(host, blob, rawTranscript, answerForReview);
  return { blob, transcript: review.transcript, rawTranscript, earlyFinish, nextRequested: review.action === 'next' };
}

// Editable transcript step. Shows audio playback + textarea with the
// recognizer's output, and lets the user clean it up before scoring.
async function reviewTranscriptStep(host, blob, rawTranscript, correctAnswer = null) {
  return new Promise((resolve) => {
    const audioURL = URL.createObjectURL(blob);
    const reviewWrap = document.createElement("div");
    reviewWrap.className = "panel task-content";
    reviewWrap.style.marginTop = "16px";
    const answerBlock = correctAnswer
      ? `<div style="margin:14px 0; padding:14px 16px; background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.4); border-radius:10px;">
           <div style="font-size:12px; font-weight:700; letter-spacing:1.5px; text-transform:uppercase; color:#34d399; margin-bottom:6px;">✓ Đáp án đúng</div>
           <div style="font-size:16px; line-height:1.6; color:#eef1f8;">${escapeHtml(correctAnswer)}</div>
         </div>`
      : "";
    reviewWrap.innerHTML = `
      <h3>${correctAnswer ? "Đáp án & bản ghi của bạn" : "Review transcript before scoring"}</h3>
      ${answerBlock}
      <p class="small muted">
        Nghe lại bản ghi của bạn và sửa lại những từ hệ thống nhận dạng sai (nếu có).
        Chọn <strong>Chấm điểm</strong> để xem điểm, hoặc <strong>Câu tiếp theo</strong> để làm tiếp.
      </p>
      <audio controls src="${audioURL}" style="width:100%; margin:8px 0;"></audio>
      <textarea class="essay" id="transcript-edit" style="min-height:120px;">${escapeHtml(rawTranscript)}</textarea>
      <div class="row" style="margin-top:14px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.08); display:flex; justify-content:flex-end; gap:10px; flex-wrap:wrap;">
        <button class="secondary" id="reset-transcript">Khôi phục bản gốc</button>
        <button class="primary" id="submit-transcript">Chấm điểm</button>
        <button class="primary" id="next-question" style="font-weight:700;">⏩ Câu tiếp theo</button>
      </div>
    `;
    host.appendChild(reviewWrap);

    const ta = reviewWrap.querySelector("#transcript-edit");
    ta.focus();
    reviewWrap.querySelector("#reset-transcript").addEventListener("click", () => {
      ta.value = rawTranscript;
    });
    reviewWrap.querySelector("#submit-transcript").addEventListener("click", () => {
      URL.revokeObjectURL(audioURL);
      const btn = reviewWrap.querySelector("#submit-transcript");
      if (btn) { btn.disabled = true; btn.textContent = "⏳ Đang chấm điểm…"; }
      const nq = reviewWrap.querySelector("#next-question");
      if (nq) nq.disabled = true;
      resolve({ action: "score", transcript: ta.value.trim() });
    });
    reviewWrap.querySelector("#next-question").addEventListener("click", () => {
      stopAudioUrl(); stopSpeaking();
      URL.revokeObjectURL(audioURL);
      resolve({ action: "next", transcript: ta.value.trim() });
    });
  });
}

// Scoring that never throws — returns null when AI scoring is unavailable
// (e.g. no API key / manual mode not configured), so the learner still gets
// the answer reveal instead of an error page.
async function safeScore(fn) {
  try { return await fn(); }
  catch (e) { console.warn("Scoring unavailable:", e.message); return null; }
}

// Loading bar removed per user request — kept as no-ops so imports stay valid.
function showScoringOverlay() {}
function hideScoringOverlay() {}
export { showScoringOverlay, hideScoringOverlay };

// ----------------- shared answer-reveal helper -----------------
function revealAnswers(host, title, rowsHTML, { taskId = null } = {}) {
  const panel = document.createElement("div");
  panel.className = "answer-reveal";
  panel.innerHTML = `<h3>${title}</h3>${rowsHTML}
    <div class="answer-nav" style="display:flex; justify-content:flex-end; margin-top:14px;">
      <button class="primary" id="nav-next-inline" style="font-weight:700;">⏩ Câu tiếp theo</button>
    </div>`;
  host.querySelector(".task-content").appendChild(panel);
  panel.querySelector("#nav-next-inline")?.addEventListener("click", () => {
    stopSpeaking(); stopAudioUrl();
    document.dispatchEvent(new CustomEvent("pte:next_task"));
  });
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  return panel;
}

function mcqRows(options, correctIdxs, selectedIdxs, prefix = "", reason = "") {
  const set = new Set(correctIdxs);
  const sel = new Set(selectedIdxs);
  const rows = options.map((o, i) => {
    const isCorrect = set.has(i);
    const isSelected = sel.has(i);
    let badge, cls;
    if (isCorrect) { badge = "✓ Đáp án đúng"; cls = "ok"; }
    else if (isSelected) { badge = "✗ Bạn chọn (sai)"; cls = "bad"; }
    else { badge = ""; cls = ""; }
    return `<div class="answer-row ${cls}">
      <div class="answer-row-head"><span class="answer-badge">${prefix}${String.fromCharCode(65 + i)}</span>
        <span>${escapeHtml(o)}</span>${badge ? `<span class="${isCorrect ? 'answer-tick' : 'answer-miss'}">${badge}</span>` : ""}</div>
    </div>`;
  }).join("");
  return rows + (reason ? `<div class="answer-reason" style="margin-top:10px;">💡 ${reason}</div>` : "");
}

// ----------------- task renderers -----------------

export const RENDERERS = {
  // ===== Speaking =====
  async readAloud(host) {
    const item = pick("readAloud", CONTENT.readAloud);
    const html = `
      <h2>Read Aloud</h2>
      <p class="instruction">Look at the text below. You'll have ${35}s to prepare, then ${40}s to read it aloud.</p>
      <div class="passage">${escapeHtml(item.text)}</div>
    `;
    const { transcript, blob, nextRequested } = await runSpeakingFlow({
      host, prepSeconds: 35, recordSeconds: 40, examFlow: true, answerForReview: item.text, contentHTML: html,
    });
    if (nextRequested) return { item, transcript, blob, score: null, nextRequested: true };
    const score = await safeScore(() => scoreReadAloud({ original: item.text, transcript }));
    return { item, transcript, blob, score };
  },

  async repeatSentence(host) {
    const item = pick("repeatSentence", CONTENT.repeatSentence);
    const sentence = item.text || item;
    const audioUrl = item.audio || "";
    const html = `
      <h2>Repeat Sentence</h2>
      <p class="instruction">You'll hear a sentence. After it ends, repeat it exactly.</p>
      <div style="margin-bottom:10px;"><button type="button" id="play-audio-btn" style="padding:6px 14px; background:#2563eb; color:#fff; border:none; border-radius:6px; font-weight:600; cursor:pointer;">🔊 Bấm để nghe Audio (Play Audio)</button></div>
      <p class="muted">Listening…</p>
    `;
    const { transcript, blob, nextRequested } = await runSpeakingFlow({
      host,
      prepSeconds: 0,
      recordSeconds: 15,
      examFlow: true,
      answerForReview: sentence,
      contentHTML: html,
      speakBefore: async () => {
        host.querySelector("#phase-msg").textContent = "Nghe câu, rồi lặp lại. Bấm 🔊 nếu chưa nghe.";
        const playAudio = () => playAudioUrl(audioUrl, { fallbackText: sentence });
        host.querySelector("#play-audio-btn")?.addEventListener("click", playAudio);
        // Wait for audio, but never hang if iOS blocks autoplay.
        await Promise.race([playAudio(), new Promise((r) => setTimeout(r, 8000))]);
      },
    });
    if (nextRequested) return { item: { original: sentence }, transcript, blob, score: null, nextRequested: true };
    const score = await safeScore(() => scoreRepeatSentence({ original: sentence, transcript }));
    return { item: { original: sentence }, transcript, blob, score };
  },

  async describeImage(host) {
    const item = pick("describeImage", CONTENT.describeImage);
    const svg = item.imageLink 
      ? `<div style="text-align:center; margin:12px 0;"><img src="${escapeHtml(item.imageLink)}" style="max-width:100%; max-height:360px; border-radius:8px; border:1px solid #ccc;" alt="Describe Image"/></div>`
      : renderChart(item);
    const html = `
      <h2>Describe Image</h2>
      <p class="instruction">Look at the image. You'll have 25s to prepare, then 40s to describe what it shows.</p>
      ${svg}
    `;
    const { transcript, blob, nextRequested } = await runSpeakingFlow({
      host, prepSeconds: 25, recordSeconds: 40, examFlow: true, answerForReview: describeChartData(item), contentHTML: html,
    });
    if (nextRequested) return { item, transcript, blob, score: null, nextRequested: true };
    const score = await safeScore(() => scoreDescribeImage({
      title: item.title,
      dataDescription: describeChartData(item),
      transcript,
    }));
    return { item, transcript, blob, score };
  },

  async retellLecture(host) {
    const item = pick("retellLecture", CONTENT.retellLecture);
    const html = `
      <h2>Re-tell Lecture</h2>
      <p class="instruction">Nghe bài giảng. Bạn có 10 giây chuẩn bị, rồi 40 giây để thuật lại các ý chính.</p>
      <p class="muted"><strong>${escapeHtml(item.title)}</strong></p>
      <div style="margin-bottom:10px;"><button type="button" id="play-audio-btn" style="padding:6px 14px; background:#2563eb; color:#fff; border:none; border-radius:6px; font-weight:600; cursor:pointer;">🔊 Bấm để nghe Audio (Play Audio)</button><span id="audio-status" class="muted" style="margin-left:10px;">▶ Chưa phát</span></div>
    `;
    const { transcript, blob, nextRequested } = await runSpeakingFlow({
      host,
      prepSeconds: 10,
      recordSeconds: 40,
      examFlow: true,
      answerForReview: item.transcript,
      contentHTML: html,
      speakBefore: async () => {
        const setStatus = (t) => { const el = host.querySelector("#audio-status"); if (el) el.textContent = t; };
        const playAudio = async () => { setStatus("▶ Đang đọc..."); await playAudioUrl(item.audio, { fallbackText: item.transcript }); setStatus("✓ Đã phát xong audio."); };
        host.querySelector("#play-audio-btn")?.addEventListener("click", playAudio);
        await Promise.race([playAudio(), new Promise((r) => setTimeout(r, 35000))]);
      },
    });
    if (nextRequested) return { item, transcript, blob, score: null, nextRequested: true };
    const score = await safeScore(() => scoreRetellLecture({
      originalTranscript: item.transcript,
      transcript,
    }));
    return { item, transcript, blob, score };
  },

  async answerShortQuestion(host) {
    const item = pick("answerShortQuestion", CONTENT.answerShortQuestion);
    const question = item.prompt || item.q || "";
    const html = `
      <h2>Answer Short Question</h2>
      <p class="instruction">You'll hear a short question. Answer with one or a few words.</p>
      <div style="margin-bottom:10px;"><button type="button" id="play-audio-btn" style="padding:6px 14px; background:#2563eb; color:#fff; border:none; border-radius:6px; font-weight:600; cursor:pointer;">🔊 Bấm để nghe Audio (Play Audio)</button></div>
    `;
    const { transcript, blob, nextRequested } = await runSpeakingFlow({
      host,
      prepSeconds: 0,
      recordSeconds: 10,
      examFlow: true,
      answerForReview: item.answer || item.a || "",
      contentHTML: html,
      speakBefore: async () => {
        const playAudio = () => playAudioUrl(item.audio, { fallbackText: question });
        host.querySelector("#play-audio-btn")?.addEventListener("click", playAudio);
        await Promise.race([playAudio(), new Promise((r) => setTimeout(r, 8000))]);
      },
    });
    if (nextRequested) return { item, transcript, blob, score: null, nextRequested: true };
    const score = await safeScore(() => scoreAnswerShortQuestion({
      question: question,
      acceptable: item.answer || item.a || "",
      transcript,
    }));
    return { item, transcript, blob, score };
  },

  // ===== Writing =====
  async summarizeWrittenText(host) {
    const item = pick("summarizeWrittenText", CONTENT.summarizeWrittenText);
    const passage = item.text || item.passage || "";
    return new Promise((resolve) => {
      host.innerHTML = `
        <div class="panel task-content">
          <h2>Summarize Written Text</h2>
          <p class="instruction">Đọc đoạn văn và viết tóm tắt 1 câu (5–75 từ). 10 phút.</p>
          <div class="passage">${escapeHtml(passage)}</div>
          <textarea class="essay" id="response" placeholder="Viết câu tóm tắt của bạn…"></textarea>
          <div class="word-count"><span id="wc">0</span> words</div>
          <div class="row" style="margin-top:12px;">
            <button class="primary" id="submit">Submit</button>
          </div>
        </div>
      `;
      const ta = host.querySelector("#response");
      const wc = host.querySelector("#wc");
      ta.addEventListener("input", () => { wc.textContent = wordCount(ta.value); });

      const cd = countdown(600);
      cd.promise.then((reason) => {
        if (reason === "done") submit();
      });

      async function submit() {
        stopAudioUrl(); stopSpeaking(); cd.cancel(); clearTimer();
        const btn = host.querySelector("#submit");
        btn.disabled = true;
        btn.textContent = "⏳ Đang chấm điểm…";
        const summary = ta.value.trim();
        let score = null;
        try {
          score = await scoreSummarizeWrittenText({ original: passage, summary });
        } catch (e) {
          host.querySelector("#submit").disabled = false;
          const w = document.createElement("div");
          w.className = "hint small";
          w.textContent = "Không chấm được bằng AI (chưa cấu hình). Xem đáp án gợi ý bên dưới.";
          host.querySelector(".task-content").appendChild(w);
        }
        if (score == null) {
          const rows = `<div class="answer-row ok">
            <div class="answer-row-head"><span class="answer-badge">Gợi ý</span>
              <span>Câu tóm tắt cần nêu <b>ý chính</b> của đoạn, dài <b>5–75 từ</b>, chỉ <b>1 câu</b>.</span></div>
            <div class="answer-reason"><b>Đoạn gốc:</b> ${escapeHtml(String(passage).slice(0, 400))}…</div>
          </div>`;
          revealAnswers(host, "✓ Hướng dẫn chấm", rows);
        }
        resolve({ item, summary, score });
      }
      host.querySelector("#submit").addEventListener("click", submit);
    });
  },

  async writeEssay(host) {
    const item = pick("writeEssay", CONTENT.writeEssay);
    const prompt = item.prompt || item.text || "";
    return new Promise((resolve) => {
      host.innerHTML = `
        <div class="panel task-content">
          <h2>Write Essay</h2>
          <p class="instruction">Viết bài luận 200–300 từ theo chủ đề dưới đây. 20 phút.</p>
          <div class="passage">${escapeHtml(prompt)}</div>
          <textarea class="essay" id="response" style="min-height:300px;" placeholder="Viết bài luận…"></textarea>
          <div class="word-count"><span id="wc">0</span> words</div>
          <div class="row" style="margin-top:12px;">
            <button class="primary" id="submit">Submit</button>
          </div>
        </div>
      `;
      const ta = host.querySelector("#response");
      const wc = host.querySelector("#wc");
      ta.addEventListener("input", () => { wc.textContent = wordCount(ta.value); });

      const cd = countdown(1200);
      cd.promise.then((r) => { if (r === "done") submit(); });

      async function submit() {
        stopAudioUrl(); stopSpeaking(); cd.cancel(); clearTimer();
        const btn = host.querySelector("#submit");
        btn.disabled = true;
        btn.textContent = "⏳ Đang chấm điểm…";
        const essay = ta.value.trim();
        let score = null;
        try {
          score = await scoreEssay({ prompt, essay });
        } catch (e) {
          host.querySelector("#submit").disabled = false;
          const w = document.createElement("div");
          w.className = "hint small";
          w.textContent = "Không chấm được bằng AI (chưa cấu hình). Xem hướng dẫn bên dưới.";
          host.querySelector(".task-content").appendChild(w);
        }
        if (score == null) {
          const words = wordCount(essay);
          const rows = `<div class="answer-row ${words >= 200 && words <= 300 ? 'ok' : 'bad'}">
            <div class="answer-row-head"><span class="answer-badge">Độ dài</span>
              <span>Bạn viết <b>${words}</b> từ — yêu cầu <b>200–300 từ</b>.</span></div>
            <div class="answer-reason">Cấu trúc chuẩn: <b>Mở bài</b> (nêu quan điểm) → <b>2–3 thân bài</b> (luận điểm + ví dụ) → <b>Kết luận</b>. Dùng từ nối (however, moreover, therefore) để tăng cohesion.</div>
          </div>`;
          revealAnswers(host, "✓ Hướng dẫn chấm Essay", rows);
        }
        resolve({ item: { prompt }, essay, score });
      }
      host.querySelector("#submit").addEventListener("click", submit);
    });
  },

  // ===== Reading =====
  async readingFillBlanksRW(host) {
    const item = pick("readingFillBlanksRW", CONTENT.readingFillBlanksRW);
    return new Promise((resolve) => {
      const correct = [];
      const optsByBlank = {};
      const html = item.text.map((seg, idx) => {
        if (typeof seg === "string") return escapeHtml(seg);
        correct[seg.blank] = seg.correct;
        optsByBlank[seg.blank] = seg.options || [seg.correct];
        const opts = ["", ...seg.options]
          .map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o || "—")}</option>`)
          .join("");
        return `<select class="blank-dropdown" data-blank="${seg.blank}">${opts}</select>`;
      }).join("");

      // Build a contextual sentence around each blank for the explanation.
      const contextFor = (blankIdx) => {
        const joined = item.text.map((s) => typeof s === "string" ? s : (s.blank === blankIdx ? " ⟦…⟧ " : " … ")).join("");
        return joined.replace(/\s+/g, " ").trim();
      };

      const reasonFor = (blankIdx, correctWord, options) => {
        const segs = item.text;
        let before = "", after = "";
        let seen = false;
        for (const s of segs) {
          if (typeof s === "string") {
            if (seen) { after += s; if (after.trim().length > 0) break; }
            else before += s;
          } else if (s.blank === blankIdx) { seen = true; }
        }
        // fall back: full joined context if split failed
        if (!before && !after) {
          before = segs.map((s) => typeof s === "string" ? s : "___").join("").slice(0, 80);
        }
        return explainFillBlank({ correct: correctWord, options, before, after });
      };

      host.innerHTML = `
        <div class="panel task-content">
          <h2>Reading &amp; Writing — Fill in the Blanks</h2>
          <p class="instruction">Chọn từ đúng nhất cho mỗi ô trống.</p>
          <div class="passage">${html}</div>
          <button class="primary" id="submit">Submit</button>
        </div>
      `;
      const cd = countdown(180);
      cd.promise.then((r) => { if (r === "done") submit(); });

      function submit() {
        stopAudioUrl(); stopSpeaking(); cd.cancel(); clearTimer();
        const answers = correct.map((_, i) => {
          const el = host.querySelector(`select[data-blank="${i}"]`);
          return el?.value || "";
        });
        const score = scoreFillBlanks(answers, correct);
        host.querySelectorAll("select").forEach((el) => {
          const i = parseInt(el.dataset.blank);
          if (el.value === correct[i]) { el.style.background = "rgba(16,185,129,0.25)"; el.style.borderColor = "#10b981"; }
          else { el.style.background = "rgba(244,63,94,0.22)"; el.style.borderColor = "#f43f5e"; }
          el.disabled = true;
        });

        // Answer + explanation panel
        const rows = correct.map((c, i) => {
          const user = answers[i];
          const ok = user === c;
          return `<div class="answer-row ${ok ? "ok" : "bad"}">
            <div class="answer-row-head"><span class="answer-badge">Ô ${i + 1}</span>
              <span>Đáp án đúng: <b class="answer-correct">${escapeHtml(c)}</b></span>
              ${ok ? '<span class="answer-tick">✓ Bạn đúng</span>' : `<span class="answer-miss">✗ Bạn chọn: ${escapeHtml(user || "(bỏ trống)")}</span>`}
            </div>
            <div class="answer-reason">${reasonFor(i, c, optsByBlank[i])}</div>
          </div>`;
        }).join("");

        revealAnswers(host, "✓ Đáp án &amp; giải thích", rows);

        host.querySelector("#submit").disabled = true;
        resolve({ item, answers, correct, score });
      }
      host.querySelector("#submit").addEventListener("click", submit);
    });
  },

  async readingMCMA(host) {
    const item = pick("readingMCMA", CONTENT.readingMCMA);
    return new Promise((resolve) => {
      const opts = item.options.map((o, i) => `
        <label class="mcq-option" data-i="${i}">
          <input type="checkbox" value="${i}" />
          <span>${escapeHtml(o)}</span>
        </label>
      `).join("");
      host.innerHTML = `
        <div class="panel task-content">
          <h2>Multiple Choice — Multiple Answers</h2>
          <p class="instruction">Read the passage and select all statements supported by it.</p>
          <div class="passage">${escapeHtml(item.passage)}</div>
          <p><strong>${escapeHtml(item.question)}</strong></p>
          ${opts}
          <button class="primary" id="submit" style="margin-top:12px;">Submit</button>
        </div>
      `;
      const cd = countdown(120);
      cd.promise.then((r) => { if (r === "done") submit(); });

      host.querySelectorAll(".mcq-option").forEach((opt) => {
        opt.addEventListener("click", (e) => {
          if (e.target.tagName !== "INPUT") {
            const cb = opt.querySelector("input");
            cb.checked = !cb.checked;
          }
          opt.classList.toggle("selected", opt.querySelector("input").checked);
        });
      });

      function submit() {
        stopAudioUrl(); stopSpeaking(); cd.cancel(); clearTimer();
        const selected = [...host.querySelectorAll("input:checked")].map((cb) => parseInt(cb.value));
        const score = scoreMCMA(selected, item.correct);
        host.querySelectorAll(".mcq-option").forEach((opt) => {
          const i = parseInt(opt.dataset.i);
          if (item.correct.includes(i)) opt.classList.add("correct");
          else if (selected.includes(i)) opt.classList.add("incorrect");
        });
        host.querySelector("#submit").disabled = true;
        revealAnswers(host, "✓ Đáp án đúng", mcqRows(item.options, item.correct, selected, "", explainMCQ({ options: item.options, correctIdxs: item.correct })));
        resolve({ item, selected, score });
      }
      host.querySelector("#submit").addEventListener("click", submit);
    });
  },

  async reorderParagraphs(host) {
    const item = pick("reorderParagraphs", CONTENT.reorderParagraphs);
    const indexed = item.paragraphs.map((p, i) => ({ i, p }));
    const shuffled = [...indexed].sort(() => Math.random() - 0.5);
    const correctOrder = item.paragraphs.map((_, i) => i);

    return new Promise((resolve) => {
      host.innerHTML = `
        <div class="panel task-content">
          <h2>Re-order Paragraphs</h2>
          <p class="instruction">Kéo thả hoặc dùng nút ⬆️ / ⬇️ để sắp xếp các đoạn văn theo thứ tự đúng.</p>
          <ul class="reorder-list" id="list">
            ${shuffled.map(({ i, p }) => `
              <li class="reorder-item" draggable="true" data-i="${i}" style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
                <div style="flex:1;">
                  <span class="muted" style="cursor:grab; margin-right:8px;">≡</span> ${escapeHtml(p)}
                </div>
                <div class="reorder-btns" style="display:flex; gap:4px; flex-shrink:0;">
                  <button type="button" class="btn-up" style="padding:4px 8px; font-size:12px; cursor:pointer; background:#334155; color:#fff; border-radius:4px; border:1px solid #475569;">⬆️</button>
                  <button type="button" class="btn-down" style="padding:4px 8px; font-size:12px; cursor:pointer; background:#334155; color:#fff; border-radius:4px; border:1px solid #475569;">⬇️</button>
                </div>
              </li>
            `).join("")}
          </ul>
          <button class="primary" id="submit" style="margin-top:15px;">Submit</button>
        </div>
      `;
      const list = host.querySelector("#list");
      
      // Button controls for iPad & Touch devices
      list.addEventListener("click", (e) => {
        const btnUp = e.target.closest(".btn-up");
        const btnDown = e.target.closest(".btn-down");
        if (btnUp) {
          const li = btnUp.closest(".reorder-item");
          const prev = li.previousElementSibling;
          if (prev) list.insertBefore(li, prev);
        } else if (btnDown) {
          const li = btnDown.closest(".reorder-item");
          const next = li.nextElementSibling;
          if (next) list.insertBefore(next, li);
        }
      });

      // Desktop HTML5 drag & drop
      let dragEl = null;
      list.addEventListener("dragstart", (e) => {
        dragEl = e.target.closest(".reorder-item");
        dragEl?.classList.add("dragging");
      });
      list.addEventListener("dragend", () => {
        dragEl?.classList.remove("dragging");
        dragEl = null;
      });
      list.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (!dragEl) return;
        const target = e.target.closest(".reorder-item");
        if (!target || target === dragEl) return;
        const rect = target.getBoundingClientRect();
        const before = (e.clientY - rect.top) < rect.height / 2;
        list.insertBefore(dragEl, before ? target : target.nextSibling);
      });

      const cd = countdown(180);
      cd.promise.then((r) => { if (r === "done") submit(); });

      function submit() {
        stopAudioUrl(); stopSpeaking(); cd.cancel(); clearTimer();
        const order = [...list.querySelectorAll(".reorder-item")].map((li) => parseInt(li.dataset.i));
        const score = scoreReorder(order, correctOrder);
        const rows = item.paragraphs.map((p, i) => `<div class="answer-row ok">
          <div class="answer-row-head"><span class="answer-badge">${i + 1}</span>
            <span>${escapeHtml(p)}</span></div>
        </div>`).join("");
        host.querySelector("#submit").disabled = true;
        revealAnswers(host, "✓ Thứ tự đúng", rows + `<div class="answer-reason" style="margin-top:10px;">💡 ${explainReorder(order, correctOrder, item.paragraphs)}</div>`);
        resolve({ item, order, correctOrder, score });
      }
      host.querySelector("#submit").addEventListener("click", submit);
    });
  },

  async readingFillBlanks(host) {
    const item = pick("readingFillBlanks", CONTENT.readingFillBlanks);
    return new Promise((resolve) => {
      // Render text with drop targets and a word bank below
      let blankIdx = 0;
      const textHTML = item.text.map((seg) => {
        if (typeof seg === "string") return escapeHtml(seg);
        const i = blankIdx++;
        return `<span class="blank-drop-target" data-blank="${i}"></span>`;
      }).join("");
      const bankHTML = item.bank
        .map((w, i) => `<span class="word-chip" draggable="true" data-word="${escapeHtml(w)}" data-id="bank-${i}">${escapeHtml(w)}</span>`)
        .join("");

      host.innerHTML = `
        <div class="panel task-content">
          <h2>Reading — Fill in the Blanks</h2>
          <p class="instruction">Drag the correct word from the bank into each blank.</p>
          <div class="passage">${textHTML}</div>
          <div class="word-bank" id="bank">${bankHTML}</div>
          <button class="primary" id="submit" style="margin-top:12px;">Submit</button>
        </div>
      `;

      const targets = host.querySelectorAll(".blank-drop-target");
      const bank = host.querySelector("#bank");
      const chips = host.querySelectorAll(".word-chip");

      // ---- Tap-to-place (tap a word, then tap a blank) ----
      let selectedChip = null;
      function setSelected(chip) {
        host.querySelectorAll(".word-chip.selected-chip").forEach((c) => c.classList.remove("selected-chip"));
        selectedChip = chip;
        if (chip) chip.classList.add("selected-chip");
      }

      // ---- Unified placement ----
      function placeWord(target, word, fromChip) {
        const existing = target.dataset.word;
        if (existing) {
          const chip = document.createElement("span");
          chip.className = "word-chip";
          chip.draggable = true;
          chip.dataset.word = existing;
          chip.textContent = existing;
          attachChipDrag(chip);
          bank.appendChild(chip);
        }
        target.textContent = word;
        target.dataset.word = word;
        target.classList.add("filled");
        fromChip?.remove();
      }

      // ---- Touch drag (iPad/iPhone) ----
      let touchGhost = null, touchChip = null, touchWord = null;
      function onTouchStart(e) {
        const chip = e.currentTarget;
        const t = e.touches ? e.touches[0] : e;
        touchChip = chip;
        touchWord = chip.dataset.word;
        touchGhost = chip.cloneNode(true);
        touchGhost.classList.add("touch-ghost");
        touchGhost.style.left = t.clientX + "px";
        touchGhost.style.top = t.clientY + "px";
        document.body.appendChild(touchGhost);
        chip.classList.add("dragging");
      }
      function onTouchMove(e) {
        if (!touchGhost) return;
        const t = e.touches ? e.touches[0] : e;
        if (e.cancelable) e.preventDefault();
        touchGhost.style.left = t.clientX + "px";
        touchGhost.style.top = t.clientY + "px";
        // highlight the blank under the finger
        targets.forEach((el) => el.classList.remove("over"));
        const el = document.elementFromPoint(t.clientX, t.clientY);
        const blank = el && el.closest ? el.closest(".blank-drop-target") : null;
        if (blank) blank.classList.add("over");
      }
      function onTouchEnd(e) {
        if (!touchGhost) return;
        const t = e.changedTouches ? e.changedTouches[0] : e;
        const el = document.elementFromPoint(t.clientX, t.clientY);
        const blank = el && el.closest ? el.closest(".blank-drop-target") : null;
        if (blank && touchWord) placeWord(blank, touchWord, touchChip);
        touchGhost.remove();
        touchGhost = null;
        touchChip?.classList.remove("dragging");
        touchChip = null; touchWord = null;
        targets.forEach((el) => el.classList.remove("over"));
      }

      function attachChipDrag(chip) {
        chip.addEventListener("dragstart", (e) => {
          dragWord = chip.dataset.word;
          dragChip = chip;
          chip.classList.add("dragging");
        });
        chip.addEventListener("dragend", () => chip.classList.remove("dragging"));
        chip.addEventListener("click", () => {
          if (selectedChip === chip) { setSelected(null); return; }
          setSelected(chip);
        });
        // touch drag
        chip.addEventListener("touchstart", onTouchStart, { passive: true });
        chip.addEventListener("touchmove", onTouchMove, { passive: false });
        chip.addEventListener("touchend", onTouchEnd);
      }
      chips.forEach(attachChipDrag);

      let dragWord = null, dragChip = null;

      targets.forEach((t) => {
        t.addEventListener("dragover", (e) => { e.preventDefault(); t.classList.add("over"); });
        t.addEventListener("dragleave", () => t.classList.remove("over"));
        t.addEventListener("drop", (e) => {
          e.preventDefault();
          t.classList.remove("over");
          if (!dragWord) return;
          placeWord(t, dragWord, dragChip);
          dragWord = null; dragChip = null;
        });
        t.addEventListener("click", () => {
          if (selectedChip) {
            placeWord(t, selectedChip.dataset.word, selectedChip);
            setSelected(null);
            return;
          }
          if (!t.dataset.word) return;
          const chip = document.createElement("span");
          chip.className = "word-chip";
          chip.draggable = true;
          chip.dataset.word = t.dataset.word;
          chip.textContent = t.dataset.word;
          attachChipDrag(chip);
          bank.appendChild(chip);
          t.textContent = "";
          delete t.dataset.word;
          t.classList.remove("filled");
        });
      });

      const cd = countdown(150);
      cd.promise.then((r) => { if (r === "done") submit(); });

      function submit() {
        stopAudioUrl(); stopSpeaking(); cd.cancel(); clearTimer();
        const answers = [...targets].map((t) => t.dataset.word || "");
        const score = scoreFillBlanks(answers, item.correct);
        targets.forEach((t, i) => {
          if ((t.dataset.word || "") === item.correct[i]) { t.style.background = "rgba(16,185,129,0.25)"; t.style.borderColor = "#10b981"; }
          else { t.style.background = "rgba(244,63,94,0.22)"; t.style.borderColor = "#f43f5e"; }
        });
        const rows = item.correct.map((cw, i) => {
          const user = answers[i];
          const ok = user === cw;
          return `<div class="answer-row ${ok ? "ok" : "bad"}">
            <div class="answer-row-head"><span class="answer-badge">Ô ${i + 1}</span>
              <span>Đáp án đúng: <b class="answer-correct">${escapeHtml(cw)}</b></span>
              ${ok ? '<span class="answer-tick">✓ Bạn đúng</span>' : `<span class="answer-miss">✗ Bạn chọn: ${escapeHtml(user || "(bỏ trống)")}</span>`}</div>
          </div>`;
        }).join("");
        host.querySelector("#submit").disabled = true;
        revealAnswers(host, "✓ Đáp án đúng", rows);
        resolve({ item, answers, score });
      }
      host.querySelector("#submit").addEventListener("click", submit);
    });
  },

  async readingMCSA(host) {
    const item = pick("readingMCSA", CONTENT.readingMCSA);
    return new Promise((resolve) => {
      const opts = item.options.map((o, i) => `
        <label class="mcq-option" data-i="${i}">
          <input type="radio" name="r" value="${i}" />
          <span>${escapeHtml(o)}</span>
        </label>
      `).join("");
      host.innerHTML = `
        <div class="panel task-content">
          <h2>Multiple Choice — Single Answer</h2>
          <p class="instruction">Read the passage and select the best answer.</p>
          <div class="passage">${escapeHtml(item.passage)}</div>
          <p><strong>${escapeHtml(item.question)}</strong></p>
          ${opts}
          <button class="primary" id="submit" style="margin-top:12px;">Submit</button>
        </div>
      `;
      host.querySelectorAll(".mcq-option").forEach((opt) => {
        opt.addEventListener("click", () => {
          opt.querySelector("input").checked = true;
          host.querySelectorAll(".mcq-option").forEach((o) => o.classList.remove("selected"));
          opt.classList.add("selected");
        });
      });

      const cd = countdown(90);
      cd.promise.then((r) => { if (r === "done") submit(); });

      function submit() {
        stopAudioUrl(); stopSpeaking(); cd.cancel(); clearTimer();
        const sel = host.querySelector("input:checked");
        const selectedIdx = sel ? parseInt(sel.value) : -1;
        const score = scoreMCSA(selectedIdx, item.correct);
        host.querySelectorAll(".mcq-option").forEach((opt) => {
          const i = parseInt(opt.dataset.i);
          if (i === item.correct) opt.classList.add("correct");
          else if (i === selectedIdx) opt.classList.add("incorrect");
        });
        host.querySelector("#submit").disabled = true;
        revealAnswers(host, "✓ Đáp án đúng", mcqRows(item.options, [item.correct], [selectedIdx], "", explainMCQ({ options: item.options, correctIdxs: [item.correct] })));
        resolve({ item, selectedIdx, score });
      }
      host.querySelector("#submit").addEventListener("click", submit);
    });
  },

  // ===== Listening =====
  async summarizeSpokenText(host) {
    const item = pick("summarizeSpokenText", CONTENT.summarizeSpokenText);
    return new Promise(async (resolve) => {
      host.innerHTML = `
        <div class="panel task-content">
          <h2>Summarize Spoken Text</h2>
          <p class="instruction">
            Listen to the audio (it plays only once), then write a 50-70 word summary.
            You can take notes in the box below while listening. 10 minutes total.
          </p>
          <p><strong>${escapeHtml(item.title)}</strong></p>
          <div style="margin-bottom:10px;"><button type="button" id="play-audio-btn" style="padding:6px 14px; background:#2563eb; color:#fff; border:none; border-radius:6px; font-weight:600; cursor:pointer;">🔊 Bấm để nghe Audio (Play Audio)</button><span id="audio-status" class="muted" style="margin-left:10px;">▶ Chưa phát</span></div>
          <textarea class="essay" id="response" placeholder="Take notes here while listening, then write your 50-70 word summary…"></textarea>
          <div class="word-count"><span id="wc">0</span> words</div>
          <div class="row" style="margin-top:12px;">
            <button class="primary" id="submit">Submit for scoring</button>
            <span class="spacer"></span>
            <span id="submit-status" class="small muted"></span>
          </div>
        </div>
      `;
      const ta = host.querySelector("#response");
      const wc = host.querySelector("#wc");
      const submitBtn = host.querySelector("#submit");
      const statusEl = host.querySelector("#submit-status");
      ta.addEventListener("input", () => { wc.textContent = wordCount(ta.value); });
      ta.focus();

      const cd = countdown(600);
      cd.promise.then((r) => { if (r === "done") submit(); });

      // Audio plays once, in parallel with the typing window. Mirrors the
      // real PTE where you only hear it once but timing is on you.
      const playAudio = async () => { host.querySelector("#audio-status").textContent = "▶ Đang đọc..."; await playAudioUrl(item.audio, { fallbackText: item.transcript }); host.querySelector("#audio-status").textContent = "✓ Đã phát xong audio. Hãy viết tóm tắt và nộp bài."; };
      playAudio();
      host.querySelector("#play-audio-btn")?.addEventListener("click", playAudio);

      let submitting = false;
      async function submit() {
        if (submitting) return;
        submitting = true;
        stopAudioUrl(); stopSpeaking(); cd.cancel(); clearTimer();
        submitBtn.disabled = true;
        statusEl.textContent = "Chấm điểm…";
        const summary = ta.value.trim();

        // Always show the original transcript + key points so the learner gets
        // the content/materials regardless of AI scoring availability.
        const keyWords = String(item.transcript || "")
          .toLowerCase().match(/[a-z]{5,}/g) || [];
        const freq = {};
        keyWords.forEach((w) => { freq[w] = (freq[w] || 0) + 1; });
        const keys = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w]) => w);
        const rows = `
          <div class="answer-row ok">
            <div class="answer-row-head"><span class="answer-badge">Transcript</span></div>
            <div class="answer-reason" style="color:#dbe3f5;">${escapeHtml(item.transcript || "(không có transcript)")}</div>
          </div>
          <div class="answer-row ok">
            <div class="answer-row-head"><span class="answer-badge">Từ khoá</span>
              <span>${keys.map((k) => `<b class="answer-correct">${escapeHtml(k)}</b>`).join(", ")}</span></div>
            <div class="answer-reason">Nên tóm tắt 50–70 từ, gộp các ý chính và dùng các từ khoá trên.</div>
          </div>`;
        revealAnswers(host, "✓ Transcript gốc &amp; từ khoá", rows);

        try {
          const score = await scoreSummarizeSpokenText({
            originalTranscript: item.transcript, summary,
          });
          resolve({ item, summary, score });
        } catch (e) {
          submitting = false;
          submitBtn.disabled = false;
          statusEl.textContent = "Không chấm được bằng AI (chưa cấu hình). Đã hiện transcript để bạn tham khảo.";
        }
      }
      submitBtn.addEventListener("click", submit);
    });
  },

  async listeningMCMA(host) {
    const item = pick("listeningMCMA", CONTENT.listeningMCMA);
    return new Promise(async (resolve) => {
      const opts = item.options.map((o, i) => `
        <label class="mcq-option" data-i="${i}">
          <input type="checkbox" value="${i}" disabled />
          <span>${escapeHtml(o)}</span>
        </label>
      `).join("");
      host.innerHTML = `
        <div class="panel task-content">
          <h2>Listening — Multiple Choice, Multiple Answers</h2>
          <p class="instruction">Listen carefully, then select all correct answers.</p>
          <p><strong>${escapeHtml(item.title)}</strong></p>
          <div style="margin-bottom:10px;"><button type="button" id="play-audio-btn" style="padding:6px 14px; background:#2563eb; color:#fff; border:none; border-radius:6px; font-weight:600; cursor:pointer;">🔊 Bấm để nghe Audio (Play Audio)</button><span id="audio-status" class="muted" style="margin-left:10px;">▶ Chưa phát</span></div>
          <p style="margin-top:12px;"><strong>${escapeHtml(item.question)}</strong></p>
          ${opts}
          <button class="primary" id="submit" style="margin-top:12px;" disabled>Submit</button>
        </div>
      `;
      const playAudio = async () => { host.querySelector("#audio-status").textContent = "▶ Đang đọc..."; await playAudioUrl(item.audio, { fallbackText: item.transcript }); host.querySelector("#audio-status").textContent = "✓ Đã phát xong audio."; }; playAudio(); host.querySelector("#play-audio-btn")?.addEventListener("click", playAudio);
      host.querySelector("#audio-status").textContent = "✓ Audio finished.";
      host.querySelectorAll(".mcq-option input").forEach((cb) => { cb.disabled = false; });
      host.querySelector("#submit").disabled = false;

      host.querySelectorAll(".mcq-option").forEach((opt) => {
        opt.addEventListener("click", (e) => {
          if (e.target.tagName !== "INPUT") {
            const cb = opt.querySelector("input");
            cb.checked = !cb.checked;
          }
          opt.classList.toggle("selected", opt.querySelector("input").checked);
        });
      });

      const cd = countdown(90);
      cd.promise.then((r) => { if (r === "done") submit(); });

      function submit() {
        stopAudioUrl(); stopSpeaking(); cd.cancel(); clearTimer();
        const selected = [...host.querySelectorAll("input:checked")].map((cb) => parseInt(cb.value));
        const score = scoreMCMA(selected, item.correct);
        host.querySelectorAll(".mcq-option").forEach((opt) => {
          const i = parseInt(opt.dataset.i);
          if (item.correct.includes(i)) opt.classList.add("correct");
          else if (selected.includes(i)) opt.classList.add("incorrect");
        });
        host.querySelector("#submit").disabled = true;
        revealAnswers(host, "✓ Đáp án đúng", mcqRows(item.options, item.correct, selected, "", explainMCQ({ options: item.options, correctIdxs: item.correct })));
        resolve({ item, selected, score });
      }
      host.querySelector("#submit").addEventListener("click", submit);
    });
  },

  async listeningFillBlanks(host) {
    const item = pick("listeningFillBlanks", CONTENT.listeningFillBlanks);
    return new Promise(async (resolve) => {
      // Render template with <input> for each ____
      const parts = item.template.split("_____");
      const html = parts.map((p, i) => {
        return escapeHtml(p) + (i < parts.length - 1 ? `<input type="text" class="blank-input" data-blank="${i}" style="border:1px solid #ccc; border-radius:3px; padding:2px 6px; min-width:100px; margin:0 4px;" />` : "");
      }).join("");

      host.innerHTML = `
        <div class="panel task-content">
          <h2>Listening — Fill in the Blanks</h2>
          <p class="instruction">Listen and type the missing words.</p>
          <p><strong>${escapeHtml(item.title)}</strong></p>
          <div style="margin-bottom:10px;"><button type="button" id="play-audio-btn" style="padding:6px 14px; background:#2563eb; color:#fff; border:none; border-radius:6px; font-weight:600; cursor:pointer;">🔊 Bấm để nghe Audio (Play Audio)</button><span id="audio-status" class="muted" style="margin-left:10px;">▶ Chưa phát</span></div>
          <div class="passage" style="line-height:2;">${html}</div>
          <button class="primary" id="submit" disabled>Submit</button>
        </div>
      `;
      const playAudio = async () => { host.querySelector("#audio-status").textContent = "▶ Đang đọc..."; await playAudioUrl(item.audio, { fallbackText: item.transcript }); host.querySelector("#audio-status").textContent = "✓ Đã phát xong audio."; }; playAudio(); host.querySelector("#play-audio-btn")?.addEventListener("click", playAudio);
      host.querySelector("#audio-status").textContent = "✓ Audio finished.";
      host.querySelector("#submit").disabled = false;
      host.querySelector(".blank-input")?.focus();

      const cd = countdown(60);
      cd.promise.then((r) => { if (r === "done") submit(); });

      function submit() {
        stopAudioUrl(); stopSpeaking(); cd.cancel(); clearTimer();
        const answers = [...host.querySelectorAll(".blank-input")].map((i) => i.value.trim());
        const score = scoreFillBlanks(answers, item.correct);
        host.querySelectorAll(".blank-input").forEach((inp, i) => {
          if (inp.value.trim().toLowerCase() === item.correct[i].toLowerCase()) { inp.style.background = "rgba(16,185,129,0.25)"; inp.style.borderColor = "#10b981"; }
          else { inp.style.background = "rgba(244,63,94,0.22)"; inp.style.borderColor = "#f43f5e"; }
          inp.disabled = true;
        });
        const rows = item.correct.map((cw, i) => {
          const user = (answers[i] || "").trim();
          const ok = user.toLowerCase() === cw.toLowerCase();
          return `<div class="answer-row ${ok ? "ok" : "bad"}">
            <div class="answer-row-head"><span class="answer-badge">Ô ${i + 1}</span>
              <span>Đáp án đúng: <b class="answer-correct">${escapeHtml(cw)}</b></span>
              ${ok ? '<span class="answer-tick">✓ Bạn đúng</span>' : `<span class="answer-miss">✗ Bạn điền: ${escapeHtml(user || "(bỏ trống)")}</span>`}</div>
          </div>`;
        }).join("");
        host.querySelector("#submit").disabled = true;
        revealAnswers(host, "✓ Đáp án đúng", rows + `<div class="answer-reason" style="margin-top:10px;">💡 ${explainListeningFIB(item.correct, answers)}</div>`);
        resolve({ item, answers, score });
      }
      host.querySelector("#submit").addEventListener("click", submit);
    });
  },

  async highlightCorrectSummary(host) {
    const item = pick("highlightCorrectSummary", CONTENT.highlightCorrectSummary);
    return new Promise(async (resolve) => {
      const opts = item.options.map((o, i) => `
        <label class="mcq-option" data-i="${i}">
          <input type="radio" name="r" value="${i}" disabled />
          <span>${escapeHtml(o)}</span>
        </label>
      `).join("");
      host.innerHTML = `
        <div class="panel task-content">
          <h2>Highlight Correct Summary</h2>
          <p class="instruction">Listen to the audio, then choose the best summary.</p>
          <p><strong>${escapeHtml(item.title)}</strong></p>
          <div style="margin-bottom:10px;"><button type="button" id="play-audio-btn" style="padding:6px 14px; background:#2563eb; color:#fff; border:none; border-radius:6px; font-weight:600; cursor:pointer;">🔊 Bấm để nghe Audio (Play Audio)</button><span id="audio-status" class="muted" style="margin-left:10px;">▶ Chưa phát</span></div>
          ${opts}
          <button class="primary" id="submit" style="margin-top:12px;" disabled>Submit</button>
        </div>
      `;
      const playAudio = async () => { host.querySelector("#audio-status").textContent = "▶ Đang đọc..."; await playAudioUrl(item.audio, { fallbackText: item.transcript }); host.querySelector("#audio-status").textContent = "✓ Đã phát xong audio."; }; playAudio(); host.querySelector("#play-audio-btn")?.addEventListener("click", playAudio);
      host.querySelector("#audio-status").textContent = "✓ Audio finished.";
      host.querySelectorAll(".mcq-option input").forEach((r) => { r.disabled = false; });
      host.querySelector("#submit").disabled = false;
      host.querySelectorAll(".mcq-option").forEach((opt) => {
        opt.addEventListener("click", () => {
          opt.querySelector("input").checked = true;
          host.querySelectorAll(".mcq-option").forEach((o) => o.classList.remove("selected"));
          opt.classList.add("selected");
        });
      });

      const cd = countdown(90);
      cd.promise.then((r) => { if (r === "done") submit(); });

      function submit() {
        stopAudioUrl(); stopSpeaking(); cd.cancel(); clearTimer();
        const sel = host.querySelector("input:checked");
        const selectedIdx = sel ? parseInt(sel.value) : -1;
        const score = scoreMCSA(selectedIdx, item.correct);
        host.querySelectorAll(".mcq-option").forEach((opt) => {
          const i = parseInt(opt.dataset.i);
          if (i === item.correct) opt.classList.add("correct");
          else if (i === selectedIdx) opt.classList.add("incorrect");
        });
        host.querySelector("#submit").disabled = true;
        revealAnswers(host, "✓ Đáp án đúng", mcqRows(item.options, [item.correct], [selectedIdx], "", explainMCQ({ options: item.options, correctIdxs: [item.correct] })));
        resolve({ item, selectedIdx, score });
      }
      host.querySelector("#submit").addEventListener("click", submit);
    });
  },

  async listeningMCSA(host) {
    const item = pick("listeningMCSA", CONTENT.listeningMCSA);
    return new Promise(async (resolve) => {
      const opts = item.options.map((o, i) => `
        <label class="mcq-option" data-i="${i}">
          <input type="radio" name="r" value="${i}" disabled />
          <span>${escapeHtml(o)}</span>
        </label>
      `).join("");
      host.innerHTML = `
        <div class="panel task-content">
          <h2>Listening — Multiple Choice, Single Answer</h2>
          <p class="instruction">Listen, then pick the single best answer.</p>
          <p><strong>${escapeHtml(item.title)}</strong></p>
          <div style="margin-bottom:10px;"><button type="button" id="play-audio-btn" style="padding:6px 14px; background:#2563eb; color:#fff; border:none; border-radius:6px; font-weight:600; cursor:pointer;">🔊 Bấm để nghe Audio (Play Audio)</button><span id="audio-status" class="muted" style="margin-left:10px;">▶ Chưa phát</span></div>
          <p style="margin-top:12px;"><strong>${escapeHtml(item.question)}</strong></p>
          ${opts}
          <button class="primary" id="submit" style="margin-top:12px;" disabled>Submit</button>
        </div>
      `;
      const playAudio = async () => { host.querySelector("#audio-status").textContent = "▶ Đang đọc..."; await playAudioUrl(item.audio, { fallbackText: item.transcript }); host.querySelector("#audio-status").textContent = "✓ Đã phát xong audio."; }; playAudio(); host.querySelector("#play-audio-btn")?.addEventListener("click", playAudio);
      host.querySelector("#audio-status").textContent = "✓ Audio finished.";
      host.querySelectorAll(".mcq-option input").forEach((r) => { r.disabled = false; });
      host.querySelector("#submit").disabled = false;
      host.querySelectorAll(".mcq-option").forEach((opt) => {
        opt.addEventListener("click", () => {
          opt.querySelector("input").checked = true;
          host.querySelectorAll(".mcq-option").forEach((o) => o.classList.remove("selected"));
          opt.classList.add("selected");
        });
      });

      const cd = countdown(60);
      cd.promise.then((r) => { if (r === "done") submit(); });

      function submit() {
        stopAudioUrl(); stopSpeaking(); cd.cancel(); clearTimer();
        const sel = host.querySelector("input:checked");
        const selectedIdx = sel ? parseInt(sel.value) : -1;
        const score = scoreMCSA(selectedIdx, item.correct);
        host.querySelectorAll(".mcq-option").forEach((opt) => {
          const i = parseInt(opt.dataset.i);
          if (i === item.correct) opt.classList.add("correct");
          else if (i === selectedIdx) opt.classList.add("incorrect");
        });
        host.querySelector("#submit").disabled = true;
        revealAnswers(host, "✓ Đáp án đúng", mcqRows(item.options, [item.correct], [selectedIdx], "", explainMCQ({ options: item.options, correctIdxs: [item.correct] })));
        resolve({ item, selectedIdx, score });
      }
      host.querySelector("#submit").addEventListener("click", submit);
    });
  },

  async selectMissingWord(host) {
    const item = pick("selectMissingWord", CONTENT.selectMissingWord);
    return new Promise(async (resolve) => {
      const opts = item.options.map((o, i) => `
        <label class="mcq-option" data-i="${i}">
          <input type="radio" name="r" value="${i}" />
          <span>${escapeHtml(o)}</span>
        </label>
      `).join("");
      host.innerHTML = `
        <div class="panel task-content">
          <h2>Select Missing Word</h2>
          <p class="instruction">Từ cuối của audio bị thay bằng tiếng “bip”. Chọn từ còn thiếu.</p>
          <p><strong>${escapeHtml(item.title)}</strong></p>
          <div style="margin-bottom:10px;"><button type="button" id="play-audio-btn" style="padding:6px 14px; background:#2563eb; color:#fff; border:none; border-radius:6px; font-weight:600; cursor:pointer;">🔊 Bấm để nghe Audio (Play Audio)</button><span id="audio-status" class="muted" style="margin-left:10px;">▶ Chưa phát</span></div>
          ${opts}
          <button class="primary" id="submit" style="margin-top:12px;">Submit</button>
        </div>
      `;
      const playAudio = async () => {
        host.querySelector("#audio-status").textContent = "▶ Đang đọc...";
        await playAudioUrl(item.audio, { fallbackText: item.transcript });
        host.querySelector("#audio-status").textContent = "✓ Đã phát xong audio.";
      };
      host.querySelector("#play-audio-btn")?.addEventListener("click", playAudio);

      host.querySelectorAll(".mcq-option").forEach((opt) => {
        opt.addEventListener("click", () => {
          opt.querySelector("input").checked = true;
          host.querySelectorAll(".mcq-option").forEach((o) => o.classList.remove("selected"));
          opt.classList.add("selected");
        });
      });

      const cd = countdown(30);
      cd.promise.then((r) => { if (r === "done") submit(); });

      function submit() {
        stopAudioUrl(); stopSpeaking(); cd.cancel(); clearTimer();
        const sel = host.querySelector("input:checked");
        const selectedIdx = sel ? parseInt(sel.value) : -1;
        const score = scoreMCSA(selectedIdx, item.correct);
        host.querySelectorAll(".mcq-option").forEach((opt) => {
          const i = parseInt(opt.dataset.i);
          if (i === item.correct) opt.classList.add("correct");
          else if (i === selectedIdx) opt.classList.add("incorrect");
        });
        host.querySelector("#submit").disabled = true;
        revealAnswers(host, "✓ Đáp án đúng", mcqRows(item.options, [item.correct], [selectedIdx], "", explainMCQ({ options: item.options, correctIdxs: [item.correct] })));
        resolve({ item, selectedIdx, score });
      }
      host.querySelector("#submit").addEventListener("click", submit);
    });
  },

  async highlightIncorrectWords(host) {
    const item = pick("highlightIncorrectWords", CONTENT.highlightIncorrectWords);
    // Compute which displayed words differ from spoken transcript (token-level diff).
    const spokenWords = item.spoken.split(/\s+/);
    const displayWords = item.display.split(/\s+/);
    const wrongIndices = [];
    for (let i = 0; i < displayWords.length; i++) {
      const dw = displayWords[i].replace(/[^a-zA-Z]/g, "").toLowerCase();
      const sw = (spokenWords[i] || "").replace(/[^a-zA-Z]/g, "").toLowerCase();
      if (dw !== sw) wrongIndices.push(i);
    }

    return new Promise(async (resolve) => {
      const wordHTML = displayWords.map((w, i) =>
        `<span class="transcript-word" data-i="${i}">${escapeHtml(w)}</span>`
      ).join(" ");
      host.innerHTML = `
        <div class="panel task-content">
          <h2>Highlight Incorrect Words</h2>
          <p class="instruction">Listen to the audio while reading. Click any word in the text that doesn't match what you hear.</p>
          <p><strong>${escapeHtml(item.title)}</strong></p>
          <div style="margin-bottom:10px;"><button type="button" id="play-audio-btn" style="padding:6px 14px; background:#2563eb; color:#fff; border:none; border-radius:6px; font-weight:600; cursor:pointer;">🔊 Bấm để nghe Audio (Play Audio)</button><span id="audio-status" class="muted" style="margin-left:10px;">▶ Chưa phát</span></div>
          <div class="passage" style="line-height:2;">${wordHTML}</div>
          <button class="primary" id="submit" disabled>Submit</button>
        </div>
      `;

      const flagged = new Set();
      host.querySelectorAll(".transcript-word").forEach((w) => {
        w.addEventListener("click", () => {
          const i = parseInt(w.dataset.i);
          if (flagged.has(i)) { flagged.delete(i); w.classList.remove("flagged"); }
          else { flagged.add(i); w.classList.add("flagged"); }
        });
      });

      // Speak the SPOKEN (different) version so user can hear the discrepancy
      const playAudio = async () => { host.querySelector("#audio-status").textContent = "▶ Đang đọc..."; await playAudioUrl(item.audio, { fallbackText: item.spoken }); host.querySelector("#audio-status").textContent = "✓ Đã phát xong audio."; }; playAudio(); host.querySelector("#play-audio-btn")?.addEventListener("click", playAudio);
      host.querySelector("#submit").disabled = false;

      const cd = countdown(60);
      cd.promise.then((r) => { if (r === "done") submit(); });

      function submit() {
        stopAudioUrl(); stopSpeaking(); cd.cancel(); clearTimer();
        const score = scoreHighlightIncorrectWords([...flagged], wrongIndices);
        host.querySelectorAll(".transcript-word").forEach((w) => {
          const i = parseInt(w.dataset.i);
          if (wrongIndices.includes(i)) w.classList.add("actually-wrong");
        });
        const wrongWords = wrongIndices.map((i) => displayWords[i]).filter(Boolean);
        const rows = `<div class="answer-row ok">
          <div class="answer-row-head"><span class="answer-badge">Từ đọc sai</span>
            <span><b class="answer-correct">${escapeHtml(wrongWords.join(", ")) || "(không có)"}</b></span></div>
          <div class="answer-reason">💡 ${explainHIW(wrongWords, item.spoken)}</div>
        </div>`;
        host.querySelector("#submit").disabled = true;
        revealAnswers(host, "✓ Đáp án — các từ sai", rows);
        resolve({ item, flagged: [...flagged], wrongIndices, score });
      }
      host.querySelector("#submit").addEventListener("click", submit);
    });
  },

  async writeFromDictation(host) {
    const item = pick("writeFromDictation", CONTENT.writeFromDictation);
    const sentence = item.text || item;
    const audioUrl = item.audio || "";
    return new Promise(async (resolve) => {
      host.innerHTML = `
        <div class="panel task-content">
          <h2>Write from Dictation</h2>
          <p class="instruction">Listen carefully, then type the sentence exactly as you heard it.</p>
          <div style="margin-bottom:10px;"><button type="button" id="play-audio-btn" style="padding:6px 14px; background:#2563eb; color:#fff; border:none; border-radius:6px; font-weight:600; cursor:pointer;">🔊 Bấm để nghe Audio (Play Audio)</button><span id="audio-status" class="muted" style="margin-left:10px;">▶ Chưa phát</span></div>
          <input type="text" id="response" placeholder="Type what you heard…" disabled
                 style="width:100%; padding:10px; font-size:15px; border:1px solid #ccc; border-radius:4px; margin-top:12px;" />
          <button class="primary" id="submit" style="margin-top:12px;" disabled>Submit</button>
          <div id="reveal" style="margin-top:12px;"></div>
        </div>
      `;
      const playAudio = async () => { host.querySelector("#audio-status").textContent = "▶ Đang đọc..."; await playAudioUrl(audioUrl, { fallbackText: sentence }); host.querySelector("#audio-status").textContent = "✓ Đã phát xong. Hãy gõ câu bạn nghe được."; }; playAudio(); host.querySelector("#play-audio-btn")?.addEventListener("click", playAudio);
      const inp = host.querySelector("#response");
      inp.disabled = false;
      inp.focus();
      host.querySelector("#submit").disabled = false;

      const cd = countdown(40);
      cd.promise.then((r) => { if (r === "done") submit(); });

      function submit() {
        stopAudioUrl(); stopSpeaking(); cd.cancel(); clearTimer();
        const answer = inp.value.trim();
        const score = scoreWriteFromDictation(answer, sentence);
        inp.disabled = true;
        inp.style.background = score.hits === score.total ? "rgba(16,185,129,0.2)" : "rgba(244,63,94,0.16)";
        const rows = `<div class="answer-row ${score.hits === score.total ? 'ok' : 'bad'}">
          <div class="answer-row-head"><span class="answer-badge">Đáp án</span>
            <span><b class="answer-correct">${escapeHtml(sentence)}</b></span></div>
          <div class="answer-reason">💡 ${explainWFD(sentence, answer)}</div>
        </div>`;
        host.querySelector("#reveal").innerHTML = "";
        revealAnswers(host, "✓ Đáp án đúng", rows);
        host.querySelector("#submit").disabled = true;
        resolve({ item: { sentence }, answer, score });
      }
      host.querySelector("#submit").addEventListener("click", submit);
    });
  },
};

export async function runTask(taskId, host) {
  const meta = getTaskMeta(taskId);
  setTaskLabel(meta ? `${meta.section} — ${meta.name}` : taskId);
  const fn = RENDERERS[taskId];
  if (!fn) throw new Error(`No renderer for task: ${taskId}`);
  try {
    const result = await fn(host);
    // Show VIP badge if item was repeated
    if (result?.item?.repeated) {
      const badgeWrap = document.createElement("div");
      badgeWrap.style.cssText = "position:fixed; bottom:20px; left:20px; background:#f59e0b; color:#0b1120; font-weight:800; padding:8px 16px; border-radius:20px; font-size:13px; z-index:9999; box-shadow:0 4px 12px rgba(245,158,11,0.5);";
      badgeWrap.textContent = "🔥 Câu hỏi trúng đề thi thật (VIP Repeated)";
      document.body.appendChild(badgeWrap);
      setTimeout(() => badgeWrap.remove(), 4000);
    }
    setTaskLabel("");
    clearTimer();
    hideScoringOverlay();   // always clear the loading bar when a task completes
    return result;
  } catch (e) {
    setTaskLabel("");
    clearTimer();
    stopSpeaking();
    hideScoringOverlay();
    throw e;
  }
}
