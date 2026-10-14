// App shell: home picker, settings, exam mode, score display.

import { TASKS, getTaskMeta } from "./content.js";
import { runTask, setTopbarTimer, setTaskLabel, injectItem, abortActiveTask, hideScoringOverlay } from "./tasks.js";
import { micUnavailableReason } from "./audio.js";
import { generateForTask, hasGenerator, generatedCount } from "./generation.js";
import {
  getEnglishVoices,
  getPreferredVoiceName,
  setPreferredVoiceName,
  getRate,
  setRate,
  speak,
} from "./audio.js";
import * as history from "./history.js";

const app = document.getElementById("app");

function escapeHtml(s) {
  return String(s).replace(/[<>&"]/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;",
  }[c]));
}

// ----------------- view tracking + top-bar state -----------------
let currentView = "home"; // home | about | progress | task | exam

function setView(view) {
  currentView = view;
  document.getElementById("about-btn").classList.toggle("active", view === "about");
  const inTask = (view === "task" || view === "exam");
  document.getElementById("exit-task-btn").style.display = inTask ? "" : "none";
}

// Wrapper so we don't pollute renderHome with state code.
function goHome() {
  abortActiveTask();
  setView("home");
  renderHome();
}

// ----------------- maker / social -----------------
const MAKER = {
  name: "Jason Dinh",
  role: "Tác giả & Nhà phát triển",
  linkedin: "https://nailuc.com",
  github: "https://github.com/dinhtrungthanh92",
  portfolio: "https://nailuc.com",
};

function socialLinksHTML() {
  const linkedinIcon = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.59 0 4.26 2.36 4.26 5.43v6.31zM5.34 7.43a2.06 2.06 0 11.01-4.12 2.06 2.06 0 010 4.12zm1.78 13.02H3.56V9h3.56v11.45z"/></svg>`;
  const githubIcon = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-1.93c-3.2.7-3.87-1.54-3.87-1.54-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.69 1.25 3.34.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.18a10.93 10.93 0 015.74 0c2.18-1.49 3.14-1.18 3.14-1.18.62 1.58.23 2.75.11 3.04.73.81 1.18 1.84 1.18 3.1 0 4.43-2.7 5.39-5.26 5.68.41.35.78 1.05.78 2.12v3.14c0 .3.21.67.8.55C20.21 21.39 23.5 17.08 23.5 12c0-6.35-5.15-11.5-11.5-11.5z"/></svg>`;
  const portfolioIcon = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm6.93 6h-2.95a15.65 15.65 0 00-1.38-3.56A8.03 8.03 0 0118.93 8zM12 4.07c.83 1.2 1.48 2.53 1.91 3.93h-3.82c.43-1.4 1.08-2.73 1.91-3.93zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2s.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56A7.987 7.987 0 015.08 16zm2.95-8H5.08a7.987 7.987 0 014.33-3.56A15.65 15.65 0 008.03 8zM12 19.93c-.83-1.2-1.48-2.53-1.91-3.93h3.82c-.43 1.4-1.08 2.73-1.91 3.93zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2s.07-1.35.16-2h4.68c.09.65.16 1.32.16 2s-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 01-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2s-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z"/></svg>`;
  return `
    <div class="social-links">
      <a class="social-link" href="${MAKER.linkedin}" target="_blank" rel="noopener noreferrer">${linkedinIcon}<span>LinkedIn</span></a>
      <a class="social-link" href="${MAKER.github}" target="_blank" rel="noopener noreferrer">${githubIcon}<span>GitHub</span></a>
      <a class="social-link" href="${MAKER.portfolio}" target="_blank" rel="noopener noreferrer">${portfolioIcon}<span>Portfolio</span></a>
    </div>
  `;
}

function makerFooterHTML() {
  return `
    <div class="maker-footer">
      <div class="credit">Thiết kế &amp; phát triển bởi <strong>${MAKER.name}</strong> · giấy phép MIT · 2026</div>
      ${socialLinksHTML()}
    </div>
  `;
}

// ----------------- home -----------------
function renderHome() {
  setTopbarTimer(null);
  setTaskLabel("");
  const sections = ["Speaking", "Writing", "Reading", "Listening"];
  const byType = Object.fromEntries(sections.map((s) => [s, []]));
  for (const t of TASKS) byType[t.section]?.push(t);

  const sectionsHTML = sections.map((s) => `
    <h3 class="section-heading">${s}</h3>
    <div class="home-grid">
      ${byType[s].map((t) => {
        const genCount = generatedCount(t.id);
        const canGen = hasGenerator(t.id);
        return `
          <div class="task-card" data-id="${t.id}">
            <div class="code">
              ${t.code}
              ${canGen ? `<button class="gen-btn" data-gen="${t.id}" title="Generate a fresh item with AI" aria-label="Generate">🎲</button>` : ""}
            </div>
            <div class="title">${t.name}</div>
            <div class="desc">${describeTask(t)}</div>
            ${genCount ? `<div class="small muted" style="margin-top:4px;">+${genCount} AI-generated</div>` : ""}
          </div>
        `;
      }).join("")}
    </div>
  `).join("");

  const miniExamCards = Object.entries(MINI_EXAMS).map(([id, meta]) => `
    <div class="task-card mini-exam-card" data-exam="${id}" style="border-left-color: var(--pte-blue);">
      <div class="code">${meta.code}</div>
      <div class="title">${meta.name}</div>
      <div class="desc">${meta.desc}</div>
    </div>
  `).join("");

  const totalEntries = history.getAll().length;
  app.innerHTML = `
    <section class="hero">
      <div class="hero-glow"></div>
      <div class="hero-badge">PTE ACADEMIC · ${TASKS.length} TASK TYPES · ${repeatedOn() ? "🔥 CHẾ ĐỘ REPEATED VIP (2,043 CÂU THI THẬT)" : "10,811 CÂU HỎI"}</div>
      <h1 class="hero-title">PTE Academic <span>Simulator</span></h1>
      <p class="hero-sub">Mô phỏng phòng thi PTE Academic chuyên nghiệp — ghi âm giọng nói thật, audio giọng bản xứ, chấm điểm AI. Chọn một dạng bài hoặc mini-exam bên dưới để bắt đầu.</p>
      <div class="hero-actions">
        <button class="primary" id="hero-start">🚀 Bắt đầu luyện tập</button>
        <button class="secondary" id="hero-progress">📊 Tiến độ${totalEntries ? ` (${totalEntries})` : ""}</button>
        <button class="secondary" id="hero-about">📖 Về dự án</button>
      </div>
      <div class="hero-author">
        <span class="hero-author-label">Thiết kế &amp; phát triển bởi</span>
        <span class="hero-author-name">Jason Dinh</span>
      </div>
    </section>
    ${renderBrowserBanner()}
    ${renderScoringModeBanner()}
    <h3 class="section-heading">Mini-exam variants</h3>
    <div class="home-grid">${miniExamCards}</div>
    <h3 class="section-heading">Section blocks</h3>
    <div class="row" style="margin-bottom:16px;">
      <button class="secondary" id="speaking-block">Speaking block</button>
      <button class="secondary" id="writing-block">Writing block</button>
      <button class="secondary" id="reading-block">Reading block</button>
      <button class="secondary" id="listening-block">Listening block</button>
    </div>
    ${sectionsHTML}
    ${makerFooterHTML()}
  `;

  document.getElementById("hero-start").addEventListener("click", () => {
    document.querySelector(".section-heading")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.getElementById("hero-progress").addEventListener("click", renderProgress);
  document.getElementById("hero-about").addEventListener("click", renderDocs);
  app.querySelectorAll(".task-card:not(.mini-exam-card)").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest(".gen-btn")) return; // handled below
      runSingleTask(card.dataset.id);
    });
  });
  app.querySelectorAll(".gen-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const taskId = btn.dataset.gen;
      await generateAndPractise(taskId, btn);
    });
  });
  app.querySelectorAll(".mini-exam-card").forEach((card) => {
    card.addEventListener("click", () => {
      const exam = MINI_EXAMS[card.dataset.exam];
      const tasks = typeof exam.tasks === "function" ? exam.tasks() : exam.tasks;
      startExam(tasks, exam.name);
    });
  });

  document.getElementById("speaking-block").addEventListener("click", () => startExam(byType.Speaking.map((t) => t.id), "Speaking block"));
  document.getElementById("writing-block").addEventListener("click", () => startExam(byType.Writing.map((t) => t.id), "Writing block"));
  document.getElementById("reading-block").addEventListener("click", () => startExam(byType.Reading.map((t) => t.id), "Reading block"));
  document.getElementById("listening-block").addEventListener("click", () => startExam(byType.Listening.map((t) => t.id), "Listening block"));
}

// ----------------- about / docs -----------------
function renderDocs() {
  setTopbarTimer(null);
  setTaskLabel("");
  setView("about");
  app.innerHTML = `
    <div class="back-row">
      <button class="back-link" id="docs-back-top">← Back to home</button>
      <span class="muted small">About</span>
    </div>
    <div class="docs">
      <header class="docs-hero">
        <h1>PTE Academic Simulator</h1>
        <p class="tagline">
          Nền tảng luyện thi PTE Academic chạy trên trình duyệt, đầy đủ 20 dạng bài,
          ghi âm giọng nói thật, audio giọng bản xứ và chấm điểm AI.
        </p>
        <div class="badges">
          <span class="badge">20 dạng bài</span>
          <span class="badge">10.000+ câu hỏi</span>
          <span class="badge">Chấm điểm AI</span>
          <span class="badge">Không cần cài đặt</span>
        </div>
      </header>

      <section class="docs-section">
        <h2>Giới thiệu</h2>
        <p>
          PTE Academic Simulator mô phỏng sát phòng thi thật: 20 dạng bài thuộc 4 kỹ năng
          Speaking, Writing, Reading, Listening. Bài nói được ghi âm và nhận dạng tự động,
          phần nghe dùng audio giọng bản xứ, các bài tự luận được chấm điểm AI theo tiêu chí
          của Pearson.
        </p>
        <p>
          Chỉ cần mở bằng trình duyệt — không cần cài đặt, không cần đăng ký. Tiến độ lưu ngay
          trên máy của bạn.
        </p>
      </section>

      <section class="docs-section">
        <h2>Điểm nổi bật</h2>
        <div class="feature-grid">
          <div class="feature-card">
            <div class="ftitle">🎙️ Ghi âm thật</div>
            <div class="fdesc">Ghi âm giọng nói và nhận dạng thành văn bản để chấm điểm.</div>
          </div>
          <div class="feature-card">
            <div class="ftitle">🔊 Audio bản xứ</div>
            <div class="fdesc">Phần Listening/Repeat dùng file audio giọng người thật.</div>
          </div>
          <div class="feature-card">
            <div class="ftitle">🤖 Chấm điểm AI</div>
            <div class="fdesc">Tự luận được chấm 0–90 kèm nhận xét cụ thể, không cần cấu hình.</div>
          </div>
          <div class="feature-card">
            <div class="ftitle">📚 10.000+ câu hỏi</div>
            <div class="fdesc">Kho câu hỏi thực tế cho mọi dạng bài để luyện tập.</div>
          </div>
          <div class="feature-card">
            <div class="ftitle">📊 Theo dõi tiến độ</div>
            <div class="fdesc">Lưu điểm từng lần làm, xem điểm trung bình và điểm yếu.</div>
          </div>
          <div class="feature-card">
            <div class="ftitle">🎯 Đề thi thử</div>
            <div class="fdesc">Nhiều biến thể mini-exam: theo kỹ năng, trộn ngẫu nhiên, full 20 dạng.</div>
          </div>
        </div>
      </section>

      <section class="docs-section">
        <h2>Tác giả</h2>
        <div class="maker-card">
          <div class="maker-name">${MAKER.name}</div>
          <div class="maker-bio">
            Thiết kế &amp; phát triển nền tảng <strong>PTE Academic Simulator</strong>.
            Xây dựng với mục tiêu giúp việc luyện thi PTE trở nên dễ tiếp cận: đủ dạng đề,
            có chấm điểm, và dùng được mọi lúc mọi nơi chỉ với một trình duyệt.
          </div>
          ${socialLinksHTML()}
        </div>
      </section>

      <footer class="docs-footer">
        <span>Thiết kế &amp; phát triển bởi ${MAKER.name} · giấy phép MIT · 2026</span>
        <button class="primary" id="docs-back">← Quay lại luyện tập</button>
      </footer>
    </div>
  `;
  app.querySelector("#docs-back").addEventListener("click", goHome);
  app.querySelector("#docs-back-top").addEventListener("click", goHome);
  window.scrollTo(0, 0);
}

// ----------------- progress dashboard -----------------
function renderProgress() {
  setTopbarTimer(null);
  setTaskLabel("");
  setView("progress");
  const sectionAgg = history.sectionSummary();
  const taskAgg = history.summary().sort((a, b) => a.section.localeCompare(b.section) || a.taskName.localeCompare(b.taskName));
  const weak = history.weakSpots(3);
  const total = history.getAll().length;

  if (total === 0) {
    app.innerHTML = `
      <div class="back-row">
        <button class="back-link" id="prog-back-top">← Back to home</button>
        <span class="muted small">You're viewing: Progress</span>
      </div>
      <div class="panel">
        <h1>📊 Progress</h1>
        <p>No attempts recorded yet. Practise some tasks and your scores will appear here.</p>
        <button class="primary" id="home">Back to home</button>
      </div>
    `;
    app.querySelector("#home").addEventListener("click", goHome);
    app.querySelector("#prog-back-top").addEventListener("click", goHome);
    return;
  }

  const sectionRows = sectionAgg.map((s) => `
    <div class="score-item" style="text-align:left;">
      <div class="num">${s.mean}</div>
      <div class="label">${escapeHtml(s.section)} (${s.count} attempts)</div>
    </div>
  `).join("");

  const weakBanner = weak.length
    ? `
      <div style="background:#fff8dc; border:1px solid #e8d77a; padding:12px; border-radius:4px; margin:12px 0;">
        <strong>🎯 Weakest tasks to drill:</strong>
        <ul style="margin:8px 0 0 18px; padding:0;">
          ${weak.map((w) => `
            <li>
              <a href="#" class="weak-link" data-id="${w.taskId}">${escapeHtml(w.taskName)}</a>
              — average ${w.mean} across ${w.count} attempts
            </li>
          `).join("")}
        </ul>
      </div>
    ` : "";

  const taskRows = taskAgg.map((t) => {
    const spark = renderSparkline(t.recent.map((r) => r.overall));
    return `
      <tr>
        <td style="padding:6px 8px;"><span class="muted small">${escapeHtml(t.section)}</span> · ${escapeHtml(t.taskName)}</td>
        <td style="padding:6px 8px; text-align:right;">${t.count}</td>
        <td style="padding:6px 8px; text-align:right;">${t.mean}</td>
        <td style="padding:6px 8px; text-align:right;">${t.best}</td>
        <td style="padding:6px 8px; text-align:right;">${t.last}</td>
        <td style="padding:6px 8px;">${spark}</td>
      </tr>
    `;
  }).join("");

  app.innerHTML = `
    <div class="back-row">
      <button class="back-link" id="prog-back-top">← Back to home</button>
      <span class="muted small">You're viewing: Progress · ${total} attempts</span>
    </div>
    <div class="panel">
      <h1>📊 Progress</h1>
      <p class="muted">${total} attempts recorded. Scores in PTE 0-90 scale (approximate).</p>
      <h3>Section averages</h3>
      <div class="score-grid">${sectionRows}</div>
      ${weakBanner}
      <h3>By task type</h3>
      <table style="width:100%; border-collapse:collapse; font-size:13px;">
        <thead>
          <tr style="background:#f4f8fa; text-align:left;">
            <th style="padding:6px 8px;">Task</th>
            <th style="padding:6px 8px; text-align:right;">N</th>
            <th style="padding:6px 8px; text-align:right;">Avg</th>
            <th style="padding:6px 8px; text-align:right;">Best</th>
            <th style="padding:6px 8px; text-align:right;">Last</th>
            <th style="padding:6px 8px;">Trend (last 10)</th>
          </tr>
        </thead>
        <tbody>${taskRows}</tbody>
      </table>
      <div class="row" style="margin-top:16px;">
        <button class="primary" id="home">Back to home</button>
        <span class="spacer"></span>
        <button class="danger" id="reset-history">Clear all history</button>
      </div>
    </div>
  `;
  app.querySelector("#home").addEventListener("click", goHome);
  app.querySelector("#prog-back-top").addEventListener("click", goHome);
  app.querySelector("#reset-history").addEventListener("click", () => {
    if (confirm("Delete all recorded scores? This cannot be undone.")) {
      history.clearAll();
      renderProgress();
    }
  });
  app.querySelectorAll(".weak-link").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      runSingleTask(a.dataset.id);
    });
  });
}

function renderSparkline(values) {
  if (!values || values.length === 0) return "";
  const w = 100, h = 24, pad = 2;
  const min = 0, max = 90;
  const pts = values.map((v, i) => {
    const x = pad + (values.length === 1 ? w / 2 : (i / (values.length - 1)) * (w - pad * 2));
    const y = h - pad - ((v - min) / (max - min)) * (h - pad * 2);
    return `${x},${y}`;
  });
  const last = values[values.length - 1];
  return `
    <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <polyline points="${pts.join(" ")}" fill="none" stroke="#00a8cc" stroke-width="1.5" />
      ${pts.map((p) => `<circle cx="${p.split(",")[0]}" cy="${p.split(",")[1]}" r="1.5" fill="#00a8cc" />`).join("")}
      <text x="${w - 2}" y="${h - 2}" font-size="9" text-anchor="end" fill="#666">${last}</text>
    </svg>
  `;
}

function isChromiumLike() {
  const ua = navigator.userAgent;
  // Chrome, Edge, Brave, Opera, Arc — all Chromium-based and support SpeechRecognition.
  // Safari has partial support but inconsistent. Firefox lacks it entirely.
  return /Chrome|Chromium|Edg/.test(ua) && !/Firefox/.test(ua);
}

function renderBrowserBanner() {
  const banners = [];
  const micReason = micUnavailableReason();
  if (micReason) {
    banners.push(`
      <div class="error" style="margin-top:12px;">
        <strong>Microphone unavailable.</strong> ${escapeHtml(micReason)}
      </div>
    `);
  }
  if (!isChromiumLike()) {
    banners.push(`
      <div class="error" style="margin-top:12px;">
        <strong>Your browser may not fully support this simulator.</strong>
        The Speaking tasks rely on the Web Speech Recognition API, which is only fully supported
        in Chromium-based browsers (Chrome, Edge, Brave, Arc). Reading, Writing, and Listening
        tasks will work, but Speaking transcription will be unavailable.
      </div>
    `);
  }
  return banners.join("");
}

function renderScoringModeBanner() {
  // AI scoring is automatic (local server + AI model). No setup needed.
  return `
    <div class="scoring-banner">
      🤖 <strong>Chấm điểm AI tự động</strong> — mọi bài tự luận (Speaking, Essay, Summarize) được chấm ngay, không cần cấu hình.
    </div>
  `;
}

function describeTask(t) {
  const secs = t.time ? ` · ${t.time}s` : "";
  switch (t.id) {
    case "readAloud": return "Read a short text aloud" + secs;
    case "repeatSentence": return "Repeat a spoken sentence" + secs;
    case "describeImage": return "Describe a chart or image" + secs;
    case "retellLecture": return "Summarise a short lecture" + secs;
    case "answerShortQuestion": return "One-word answers" + secs;
    case "summarizeWrittenText": return "One-sentence summary (5-75 words)";
    case "writeEssay": return "200-300 word essay";
    case "readingFillBlanksRW": return "Choose words from dropdowns";
    case "readingMCMA": return "Pick multiple correct answers";
    case "reorderParagraphs": return "Drag paragraphs into order";
    case "readingFillBlanks": return "Drag words into blanks";
    case "readingMCSA": return "Pick one correct answer";
    case "summarizeSpokenText": return "50-70 word summary of audio";
    case "listeningMCMA": return "Listen, pick multiple";
    case "listeningFillBlanks": return "Type missing words while listening";
    case "highlightCorrectSummary": return "Choose best summary";
    case "listeningMCSA": return "Listen, pick one";
    case "selectMissingWord": return "Guess the beeped-out word";
    case "highlightIncorrectWords": return "Click words that differ from audio";
    case "writeFromDictation": return "Type the dictated sentence";
    default: return "";
  }
}

// ----------------- AI generation -----------------
async function generateAndPractise(taskId, triggerBtn) {
  // AI generation uses the same automatic scorer (local server + AI model).
  const original = triggerBtn?.textContent;
  if (triggerBtn) {
    triggerBtn.textContent = "⏳";
    triggerBtn.disabled = true;
  }
  try {
    const item = await generateForTask(taskId);
    injectItem(taskId, item);
    runSingleTask(taskId);
  } catch (e) {
    alert("Generation failed: " + e.message);
    if (triggerBtn) {
      triggerBtn.textContent = original;
      triggerBtn.disabled = false;
    }
  }
}

// ----------------- single-task run -----------------
let abortRequested = false;
let currentTaskId = null;
async function runSingleTask(taskId) {
  currentTaskId = taskId;
  setView("task");
  abortActiveTask();
  app.innerHTML = "";           // clear previous task UI so the new item starts fresh
  window.scrollTo({ top: 0 });
  abortRequested = false;
  try {
    const result = await runTask(taskId, app);
    hideScoringOverlay();
    markScored();
    if (result?.nextRequested) {
      // "Câu tiếp theo" pressed at the review step — skip scoring, load a fresh item.
      setView("home");
      runSingleTask(taskId);
      return;
    }
    setView("home");
    history.addScore(taskId, result?.score);
    showScore(result, taskId, () => goHome());
  } catch (e) {
    hideScoringOverlay();
    setView("home");
    if (abortRequested) { goHome(); return; }
    showError(e, () => goHome());
  }
}

// Turn any in-progress "Đang chấm điểm…" button into a completed state.
function markScored() {
  document.querySelectorAll("button").forEach((b) => {
    if (/Đang chấm/.test(b.textContent)) {
      b.textContent = "✓ Chấm điểm xong";
      b.style.background = "#10b981";
      b.disabled = true;
    }
  });
}

// ----------------- mini-exam variants -----------------
// Each variant shuffles task order at runtime so even the same preset
// feels different each time.
function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const ALL_TASK_IDS = TASKS.map((t) => t.id);
const BY_SECTION = {
  Speaking: TASKS.filter((t) => t.section === "Speaking").map((t) => t.id),
  Writing: TASKS.filter((t) => t.section === "Writing").map((t) => t.id),
  Reading: TASKS.filter((t) => t.section === "Reading").map((t) => t.id),
  Listening: TASKS.filter((t) => t.section === "Listening").map((t) => t.id),
};

function pickN(arr, n) {
  return shuffled(arr).slice(0, n);
}

const MINI_EXAMS = {
  classic: {
    code: "Classic",
    name: "Classic Mini-Exam",
    desc: "Balanced 9-task sample touching every section (~30 min)",
    tasks: () => shuffled([
      "readAloud", "describeImage", "answerShortQuestion",
      "summarizeWrittenText",
      "readingMCMA", "reorderParagraphs",
      "summarizeSpokenText", "highlightCorrectSummary", "writeFromDictation",
    ]),
  },
  quick: {
    code: "Quick",
    name: "Quick Start",
    desc: "5 short tasks, one from each section (~12 min)",
    tasks: () => [
      ...pickN(BY_SECTION.Speaking.filter((id) => id !== "retellLecture"), 1),
      ...pickN(BY_SECTION.Writing.filter((id) => id !== "writeEssay"), 1),
      ...pickN(BY_SECTION.Reading, 1),
      ...pickN(BY_SECTION.Listening.filter((id) => id !== "summarizeSpokenText"), 2),
    ],
  },
  speakingFocus: {
    code: "Speaking",
    name: "Speaking Focus",
    desc: "All 5 Speaking tasks + 2 Listening warm-ups",
    tasks: () => [
      ...pickN(BY_SECTION.Listening.filter((id) => ["writeFromDictation", "selectMissingWord", "listeningMCSA"].includes(id)), 2),
      ...shuffled(BY_SECTION.Speaking),
    ],
  },
  writingFocus: {
    code: "Writing",
    name: "Writing Focus",
    desc: "Essay + SWT + SST + 2 Reading items",
    tasks: () => [
      "summarizeWrittenText",
      ...pickN(BY_SECTION.Reading, 2),
      "summarizeSpokenText",
      "writeEssay",
    ],
  },
  readingFocus: {
    code: "Reading",
    name: "Reading Focus",
    desc: "All 5 Reading tasks + 2 Writing items",
    tasks: () => [
      ...shuffled(BY_SECTION.Reading),
      "summarizeWrittenText",
    ],
  },
  listeningFocus: {
    code: "Listening",
    name: "Listening Focus",
    desc: "6 Listening tasks + 1 Speaking",
    tasks: () => [
      ...pickN(BY_SECTION.Listening, 6),
      ...pickN(BY_SECTION.Speaking.filter((id) => id !== "retellLecture"), 1),
    ],
  },
  weakSpot: {
    code: "Drill",
    name: "Drill (small + objective)",
    desc: "9 quick objective tasks for fast skill checks — no API needed",
    tasks: () => shuffled([
      "readingMCSA", "readingMCMA", "reorderParagraphs", "readingFillBlanks", "readingFillBlanksRW",
      "listeningMCSA", "listeningFillBlanks", "selectMissingWord", "writeFromDictation",
    ]),
  },
  random: {
    code: "Random",
    name: "Random Mix",
    desc: "8 tasks chosen randomly across all sections — different every time",
    tasks: () => pickN(ALL_TASK_IDS, 8),
  },
  fullSet: {
    code: "Full",
    name: "Full Set (all 20)",
    desc: "Every task type once. ~90 minutes — closest to a real exam.",
    tasks: () => [
      ...shuffled(BY_SECTION.Speaking),
      ...shuffled(BY_SECTION.Writing),
      ...shuffled(BY_SECTION.Reading),
      ...shuffled(BY_SECTION.Listening),
    ],
  },
};

async function startExam(taskIds, examName = "Exam") {
  setView("exam");
  abortRequested = false;
  const results = [];
  for (let i = 0; i < taskIds.length; i++) {
    if (abortRequested) {
      setView("home");
      goHome();
      return;
    }
    const id = taskIds[i];
    const progressHTML = `
      <div class="exam-progress">
        ${taskIds.map((_, j) => `<div class="step ${j < i ? "done" : j === i ? "current" : ""}"></div>`).join("")}
      </div>
      <div class="muted small" style="margin-bottom:8px;">
        ${escapeHtml(examName)} — task ${i + 1} of ${taskIds.length}
      </div>
    `;
    app.innerHTML = progressHTML;
    try {
      const result = await runTask(id, app);
      hideScoringOverlay();
      markScored();
      if (abortRequested) { setView("home"); goHome(); return; }
      history.addScore(id, result?.score);
      results.push({ taskId: id, result });
      await waitForContinue(app, i < taskIds.length - 1 ? "Next task" : "Show summary", result);
    } catch (e) {
      hideScoringOverlay();
      if (abortRequested) { setView("home"); goHome(); return; }
      console.error(e);
      results.push({ taskId: id, error: e.message });
      await waitForContinue(app, "Skip", null, e.message);
    }
  }
  setView("home");
  showExamSummary(results, examName);
}

function waitForContinue(host, label, result, errMsg) {
  return new Promise((resolve) => {
    const scoreHTML = result?.score ? renderScoreHTML(result) : (errMsg ? `<div class="error">${escapeHtml(errMsg)}</div>` : "");
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      ${scoreHTML}
      <div style="text-align:right; margin-top:12px;">
        <button class="primary" id="continue">${escapeHtml(label)}</button>
      </div>
    `;
    host.appendChild(wrap);
    wrap.querySelector("#continue").addEventListener("click", resolve);
  });
}

function showExamSummary(results, examName = "Exam") {
  const totalScores = results
    .map((r) => r.result?.score?.overall_0_90)
    .filter((n) => typeof n === "number");
  const avg = totalScores.length
    ? Math.round(totalScores.reduce((s, n) => s + n, 0) / totalScores.length)
    : null;

  const rows = results.map((r) => {
    const meta = getTaskMeta(r.taskId);
    const sc = r.result?.score?.overall_0_90;
    return `
      <tr>
        <td>${escapeHtml(meta?.name || r.taskId)}</td>
        <td style="text-align:right;">${sc == null ? "—" : sc}</td>
      </tr>
    `;
  }).join("");

  app.innerHTML = `
    <div class="panel">
      <h1>Exam Summary — ${escapeHtml(examName)}</h1>
      ${avg != null ? `
        <div class="score-panel">
          <h3>Approximate overall score (0-90 scale)</h3>
          <div style="font-size:48px; font-weight:600; color: var(--pte-blue);">${avg}</div>
          <p class="small muted">This is an approximation only — real PTE scoring uses proprietary algorithms.</p>
        </div>
      ` : ""}
      <table style="width:100%; border-collapse:collapse; margin-top:16px;">
        <thead>
          <tr style="background:#f4f8fa;">
            <th style="text-align:left; padding:8px;">Task</th>
            <th style="text-align:right; padding:8px;">Score</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="margin-top:16px;">
        <button class="primary" id="home">Back to home</button>
      </div>
    </div>
  `;
  app.querySelector("#home").addEventListener("click", goHome);
}

// ----------------- score display -----------------
function showScore(result, taskId, onContinue) {
  app.appendChild(htmlToElement(`
    <div>
      ${renderScoreHTML(result)}
      <div style="text-align:right; margin-top:16px; display:flex; justify-content:flex-end;">
        <button class="primary" id="again" style="font-weight:700;">⏩ Câu tiếp theo</button>
      </div>
    </div>
  `));
  app.querySelector("#again").addEventListener("click", () => {
    runSingleTask(taskId);
  });
}

function renderScoreHTML(result) {
  const sc = result?.score || {};
  const overall = sc.overall_0_90 ?? "—";
  const detailKeys = Object.keys(sc).filter(
    (k) => !["overall_0_90", "feedback", "correctIndexes", "raw", "maxRaw", "hits", "total", "pairs", "maxPairs", "correct"].includes(k)
  );
  const dimsHTML = detailKeys.length
    ? `<div class="score-grid">
        ${detailKeys.map((k) => `
          <div class="score-item">
            <div class="num">${sc[k]}</div>
            <div class="label">${escapeHtml(k.replace(/_/g, " "))}</div>
          </div>
        `).join("")}
      </div>`
    : "";

  const objective = sc.hits != null
    ? `<p>${sc.hits} / ${sc.total} correct</p>`
    : sc.pairs != null
    ? `<p>${sc.pairs} / ${sc.maxPairs} adjacent pairs correct</p>`
    : "";

  const transcript = result.transcript
    ? `<details style="margin-top:12px;"><summary>Your transcript</summary><div class="passage">${escapeHtml(result.transcript || "—")}</div></details>`
    : "";
  const written = result.summary || result.essay || result.answer
    ? `<details style="margin-top:12px;"><summary>Your response</summary><div class="passage">${escapeHtml(result.summary || result.essay || result.answer)}</div></details>`
    : "";

  return `
    <div class="score-panel">
      <h3>Score (approximate, 0-90 scale)</h3>
      <div style="font-size:42px; font-weight:600; color: var(--pte-blue);">${overall}</div>
      ${dimsHTML}
      ${objective}
      ${sc.feedback ? `<p><strong>Feedback:</strong> ${escapeHtml(sc.feedback)}</p>` : ""}
      ${transcript}
      ${written}
    </div>
  `;
}

function showError(err, onContinue) {
  app.innerHTML = `
    <div class="panel">
      <h2>Something went wrong</h2>
      <div class="error">${escapeHtml(err.message || String(err))}</div>
      <button class="primary" id="back">Back to home</button>
    </div>
  `;
  app.querySelector("#back").addEventListener("click", onContinue);
}

function htmlToElement(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstChild;
}

// ----------------- settings dialog -----------------
async function openSettings() {
  const dlg = document.getElementById("settings-dialog");
  const voiceSelect = document.getElementById("voice-select");
  const rateInput = document.getElementById("voice-rate");

  rateInput.value = getRate();

  const voices = await getEnglishVoices();
  const preferred = getPreferredVoiceName();
  voiceSelect.innerHTML = voices
    .map((v) => `<option value="${v.name}" ${v.name === preferred ? "selected" : ""}>${v.name} (${v.lang})</option>`)
    .join("");

  dlg.showModal();
}

document.getElementById("brand-btn").addEventListener("click", () => {
  stopAllTaskAudio(); // stop any playing audio immediately
  abortRequested = true;
  if (currentView === "task" || currentView === "exam") {
    if (!confirm("Thoát bài hiện tại và về trang chủ? Kết quả đang làm sẽ mất.")) return;
  }
  goHome();
});

document.getElementById("about-btn").addEventListener("click", () => {
  if (currentView === "about") { goHome(); return; }
  abortRequested = true;
  stopAllTaskAudio();
  renderDocs();
});

document.getElementById("exit-task-btn").addEventListener("click", () => {
  abortRequested = true;
  stopAllTaskAudio();
  setView("home");
  goHome();
});

// Best-effort cleanup when the user bails out mid-task. Cancels the
// active countdown (so the topbar timer resets) and stops TTS. Recorder
// and recognizer instances finish naturally — their DOM updates become
// no-ops once innerHTML clears the elements they were targeting.
function stopAllTaskAudio() {
  abortActiveTask();
}

document.getElementById("settings-btn").addEventListener("click", openSettings);

document.getElementById("progress-btn").addEventListener("click", () => {
  if (currentView === "progress") { goHome(); return; }
  if (currentView === "task" || currentView === "exam") {
    if (!confirm("Leave the current task and view Progress? Your in-progress response will be lost.")) return;
    abortRequested = true;
    stopAllTaskAudio();
  }
  renderProgress();
});
document.getElementById("save-settings").addEventListener("click", (e) => {
  e.preventDefault();
  setPreferredVoiceName(document.getElementById("voice-select").value);
  setRate(parseFloat(document.getElementById("voice-rate").value));
  document.getElementById("settings-dialog").close();
  renderHome();
});
document.getElementById("test-voice").addEventListener("click", async () => {
  setPreferredVoiceName(document.getElementById("voice-select").value);
  setRate(parseFloat(document.getElementById("voice-rate").value));
  await speak("This is a test of the selected voice for PTE listening tasks.");
});

// ----------------- welcome (first run) -----------------
function maybeShowWelcome() {
  const seen = localStorage.getItem("pte_welcome_seen") === "1";
  if (seen) return;

  const dlg = document.getElementById("welcome-dialog");
  const close = () => {
    localStorage.setItem("pte_welcome_seen", "1");
    dlg.close();
    renderHome();
  };
  document.getElementById("welcome-start").addEventListener("click", close, { once: true });
  dlg.showModal();
}

document.addEventListener("pte:next_task", () => {
  if (currentTaskId) runSingleTask(currentTaskId);
});

// ----------------- keyboard shortcuts & tab visibility -----------------
document.addEventListener("visibilitychange", () => {
  if (document.hidden && (currentView === "task" || currentView === "exam")) {
    abortActiveTask();
  }
});

document.addEventListener("keydown", (e) => {
  // Alt+N or Cmd+Right -> Next question
  if ((e.altKey && e.key.toLowerCase() === "n") || (e.metaKey && e.key === "ArrowRight")) {
    if (currentView === "task") {
      e.preventDefault();
      abortActiveTask();
      if (currentTaskId) runSingleTask(currentTaskId);
    }
  }
  // Ctrl+Enter or Cmd+Enter -> Submit current task if submit button is visible
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    const submitBtn = document.querySelector("#submit, #submit-transcript");
    if (submitBtn && !submitBtn.disabled) {
      e.preventDefault();
      submitBtn.click();
    }
  }
});

// ----------------- repeated-question filter -----------------
const REPEATED_KEY = "pte_only_repeated";
const repeatedToggleBtn = document.getElementById("repeated-toggle");
function repeatedOn() { return localStorage.getItem(REPEATED_KEY) === "1"; }
function syncRepeatedToggle() {
  const on = repeatedOn();
  repeatedToggleBtn.classList.toggle("active", on);
  repeatedToggleBtn.textContent = on ? "🔥 Repeated: ON" : "🔥 Repeated: OFF";
}
repeatedToggleBtn.addEventListener("click", () => {
  localStorage.setItem(REPEATED_KEY, repeatedOn() ? "0" : "1");
  syncRepeatedToggle();
  if (currentView === "home") renderHome();
});
syncRepeatedToggle();

// ----------------- init -----------------
renderHome();
maybeShowWelcome();
