// Claude API client.
//
// Two modes:
//   1. API mode — calls Anthropic directly from the browser using the
//      `anthropic-dangerous-direct-browser-access` header. Requires a
//      personal API key in localStorage. Costs money per request.
//   2. Manual mode — opens a dialog with the prompt for the user to paste
//      into claude.ai (their work plan works fine), then they paste the
//      response back. No API key, no cost.
//
// Toggle via Settings → "Manual scoring mode".

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const LOCAL_SCORE_URL = "/api/score";
const DEFAULT_MODEL = "claude-opus-4-7";
const MANUAL_KEY = "pte_manual_mode";

// The local server (/api/score) proxies to an AI model (DeepSeek) so scoring
// works out of the box without any API key. It is the default scorer.
let _localAvailable = null;

async function callLocalScorer({ system, messages, maxTokens, temperature }) {
  const res = await fetch(LOCAL_SCORE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, messages, max_tokens: maxTokens, temperature }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Local scorer ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.content || "";
}

export function getApiKey() {
  return localStorage.getItem("pte_anthropic_key") || "";
}
export function setApiKey(key) {
  localStorage.setItem("pte_anthropic_key", key.trim());
}
export function hasApiKey() { return !!getApiKey(); }

export function isManualMode() {
  return localStorage.getItem(MANUAL_KEY) === "1";
}
export function setManualMode(on) {
  localStorage.setItem(MANUAL_KEY, on ? "1" : "0");
}

// ----------------- core API call -----------------
async function callClaudeAPI({ system, messages, maxTokens, temperature, model }) {
  const key = getApiKey();
  if (!key) throw new Error("No API key set. Either add one in Settings, or enable Manual scoring mode.");
  const body = { model, max_tokens: maxTokens, temperature, messages };
  if (system) body.system = system;

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API ${res.status}: ${errText}`);
  }
  const data = await res.json();
  return data.content
    ?.filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n") || "";
}

// ----------------- manual mode -----------------
// Builds a single-string prompt that the user pastes into claude.ai. We
// prepend the system instructions so the user only has to copy ONE block.
function buildManualPrompt(system, messages) {
  const userText = messages.map((m) => m.content).join("\n\n");
  const reminder = "\n\nReturn ONLY valid JSON, no markdown fences, no commentary.";
  return `${system ? `[SYSTEM INSTRUCTIONS]\n${system}\n\n[USER]\n` : ""}${userText}${reminder}`;
}

async function callClaudeManual({ system, messages }) {
  const prompt = buildManualPrompt(system, messages);
  return new Promise((resolve, reject) => {
    const dlg = document.getElementById("manual-scoring-dialog");
    if (!dlg) return reject(new Error("Manual scoring dialog not found in DOM."));

    const promptEl = document.getElementById("manual-prompt");
    const responseEl = document.getElementById("manual-response");
    const copyBtn = document.getElementById("copy-prompt-btn");
    const submitBtn = document.getElementById("manual-submit");
    const skipBtn = document.getElementById("manual-skip");
    const statusEl = document.getElementById("manual-paste-status");

    promptEl.textContent = prompt;
    responseEl.value = "";
    statusEl.textContent = "";

    let settled = false;
    const cleanup = () => {
      copyBtn.removeEventListener("click", onCopy);
      submitBtn.removeEventListener("click", onSubmit);
      skipBtn.removeEventListener("click", onSkip);
      dlg.removeEventListener("cancel", onCancel);
      if (dlg.open) dlg.close();
    };

    const onCopy = async () => {
      try {
        await navigator.clipboard.writeText(prompt);
        copyBtn.textContent = "✓ Copied";
        copyBtn.classList.add("copy-flash");
        setTimeout(() => {
          copyBtn.textContent = "📋 Copy to clipboard";
          copyBtn.classList.remove("copy-flash");
        }, 1500);
      } catch (e) {
        statusEl.textContent = "Copy failed — select the text manually.";
      }
    };

    const onSubmit = () => {
      const raw = responseEl.value.trim();
      if (!raw) {
        statusEl.textContent = "Paste Claude's response first.";
        return;
      }
      settled = true;
      cleanup();
      resolve(raw);
    };

    const onSkip = () => {
      settled = true;
      cleanup();
      // Synthetic "skipped" JSON so scoring functions still resolve cleanly.
      resolve('{ "overall_0_90": null, "feedback": "Scoring skipped — no feedback available." }');
    };

    // Pressing Escape (or the browser closing the dialog) fires "cancel"
    // before "close". Without this handler the promise would hang and the
    // task's Submit button would stay disabled forever.
    const onCancel = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve('{ "overall_0_90": null, "feedback": "Scoring cancelled — dialog closed before submitting." }');
    };

    copyBtn.addEventListener("click", onCopy);
    submitBtn.addEventListener("click", onSubmit);
    dlg.addEventListener("cancel", onCancel);
    skipBtn.addEventListener("click", onSkip);

    dlg.showModal();
    responseEl.focus();
  });
}

// ----------------- public API -----------------
export async function callClaude({
  system,
  messages,
  maxTokens = 2048,
  temperature = 0.7,
  model = DEFAULT_MODEL,
}) {
  // 1) Manual mode — user pastes into claude.ai.
  if (isManualMode()) {
    return callClaudeManual({ system, messages });
  }
  // 2) If the user supplied an Anthropic key, use it directly.
  if (hasApiKey()) {
    return callClaudeAPI({ system, messages, maxTokens, temperature, model });
  }
  // 3) Default: local server scorer (DeepSeek) — no key needed.
  return callLocalScorer({ system, messages, maxTokens, temperature });
}

export async function callClaudeJSON(opts) {
  const raw = await callClaude(opts);
  return parseJSONLoose(raw);
}

export function parseJSONLoose(raw) {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch (_) {}
    }
    throw new Error("Could not parse JSON. First 200 chars:\n" + cleaned.slice(0, 200));
  }
}
