// Scoring helpers. Subjective tasks (Speaking, SWT, WE, SST) are scored by
// Claude using PTE-style rubrics. Objective tasks (MCQ, FIB, RO, WFD, etc.)
// are scored locally.

import { callClaudeJSON } from "./api.js";

const SYSTEM_RUBRIC = `You are a PTE Academic examiner. Score the candidate's response strictly against the official rubric for the given task type. Be objective and consistent. Convert your assessment into a 0-90 scaled score that mirrors the PTE Academic scoring range. Output ONLY valid JSON, no markdown fences.`;

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

// ============== SPEAKING ==============
export async function scoreReadAloud({ original, transcript }) {
  const prompt = `Task: Read Aloud
Original text the candidate had to read:
"""${original}"""

Candidate's spoken transcript (from speech recognition — may have minor recognition errors):
"""${transcript}"""

Score on three dimensions used by PTE:
- content (0-5): how completely the candidate read every word
- pronunciation (0-5): clarity and accuracy of pronunciation, inferred from how cleanly the recognizer captured the words
- oral_fluency (0-5): smoothness, rhythm and pace, inferred from coherence of the transcript

Return JSON:
{
  "content": number,
  "pronunciation": number,
  "oral_fluency": number,
  "overall_0_90": number,
  "feedback": "two sentences max — what to improve"
}`;
  return callClaudeJSON({ system: SYSTEM_RUBRIC, messages: [{ role: "user", content: prompt }], maxTokens: 600, temperature: 0.2 });
}

export async function scoreRepeatSentence({ original, transcript }) {
  const prompt = `Task: Repeat Sentence
Sentence played to candidate: "${original}"
Candidate's transcript: "${transcript}"

Score:
- content (0-3): proportion of words correctly repeated (3 = all, 2 = at least 50%, 1 = at least one word, 0 = nothing)
- pronunciation (0-5)
- oral_fluency (0-5)

JSON:
{ "content": n, "pronunciation": n, "oral_fluency": n, "overall_0_90": n, "feedback": "..." }`;
  return callClaudeJSON({ system: SYSTEM_RUBRIC, messages: [{ role: "user", content: prompt }], maxTokens: 500, temperature: 0.2 });
}

export async function scoreDescribeImage({ title, dataDescription, transcript }) {
  const prompt = `Task: Describe Image
Image shown: ${title}
Underlying data the candidate should describe: ${dataDescription}
Candidate transcript: "${transcript}"

Score:
- content (0-5): did the candidate describe key elements, trends, comparisons, and conclusions?
- pronunciation (0-5)
- oral_fluency (0-5)

JSON: { "content": n, "pronunciation": n, "oral_fluency": n, "overall_0_90": n, "feedback": "..." }`;
  return callClaudeJSON({ system: SYSTEM_RUBRIC, messages: [{ role: "user", content: prompt }], maxTokens: 600, temperature: 0.2 });
}

export async function scoreRetellLecture({ originalTranscript, transcript }) {
  const prompt = `Task: Re-tell Lecture
Original lecture: """${originalTranscript}"""
Candidate's retelling transcript: """${transcript}"""

Score:
- content (0-5): coverage of main points, supporting details, and overall structure
- pronunciation (0-5)
- oral_fluency (0-5)

JSON: { "content": n, "pronunciation": n, "oral_fluency": n, "overall_0_90": n, "feedback": "..." }`;
  return callClaudeJSON({ system: SYSTEM_RUBRIC, messages: [{ role: "user", content: prompt }], maxTokens: 600, temperature: 0.2 });
}

export async function scoreAnswerShortQuestion({ question, acceptable, transcript }) {
  // `acceptable` may be a single string or an array of alternatives.
  const list = Array.isArray(acceptable)
    ? acceptable.filter(Boolean)
    : String(acceptable || "").split("/").map((s) => s.trim()).filter(Boolean);
  const t = (transcript || "").toLowerCase();
  const matched = list.some((a) => a && t.includes(a.toLowerCase()));
  if (matched) {
    return { correct: true, overall_0_90: 90, feedback: "Correct answer detected." };
  }
  // Otherwise ask the model for a lenient judgement (handles synonyms / recognizer quirks).
  const prompt = `Task: Answer Short Question
Question: "${question}"
Acceptable answers: ${JSON.stringify(list)}
Candidate's transcribed answer: "${transcript}"

Is the candidate's answer correct, accounting for synonyms and minor recognition errors? Return JSON:
{ "correct": true|false, "overall_0_90": number, "feedback": "one sentence" }`;
  return callClaudeJSON({ system: SYSTEM_RUBRIC, messages: [{ role: "user", content: prompt }], maxTokens: 300, temperature: 0.1 });
}

// ============== WRITING ==============
export async function scoreSummarizeWrittenText({ original, summary }) {
  const prompt = `Task: Summarize Written Text (PTE)
Original passage: """${original}"""
Candidate's one-sentence summary: """${summary}"""

Score on PTE dimensions:
- content (0-2): captures all key points in a single sentence
- form (0-1): single sentence, 5-75 words, properly punctuated (1 = yes, 0 = no)
- grammar (0-2)
- vocabulary (0-2)

JSON: { "content": n, "form": n, "grammar": n, "vocabulary": n, "overall_0_90": n, "feedback": "..." }`;
  return callClaudeJSON({ system: SYSTEM_RUBRIC, messages: [{ role: "user", content: prompt }], maxTokens: 600, temperature: 0.2 });
}

export async function scoreEssay({ prompt: essayPrompt, essay }) {
  const prompt = `Task: Write Essay (PTE)
Prompt: """${essayPrompt}"""
Candidate's essay: """${essay}"""

Score on these PTE Writing Essay dimensions:
- content (0-3): full coverage of prompt, well-developed arguments
- form (0-2): 200-300 words (2), 120-199 or 301-380 (1), outside (0)
- development_structure_coherence (0-2)
- grammar (0-2)
- general_linguistic_range (0-2)
- vocabulary_range (0-2)
- spelling (0-2)

JSON: { "content": n, "form": n, "development_structure_coherence": n, "grammar": n, "general_linguistic_range": n, "vocabulary_range": n, "spelling": n, "overall_0_90": n, "feedback": "3 sentences with concrete improvements" }`;
  return callClaudeJSON({ system: SYSTEM_RUBRIC, messages: [{ role: "user", content: prompt }], maxTokens: 800, temperature: 0.2 });
}

export async function scoreSummarizeSpokenText({ originalTranscript, summary }) {
  const prompt = `Task: Summarize Spoken Text (PTE)
What the candidate heard: """${originalTranscript}"""
Candidate's written summary (must be 50-70 words): """${summary}"""

Score on PTE dimensions:
- content (0-2)
- form (0-2): 50-70 words (2), 40-49 or 71-100 (1), outside (0)
- grammar (0-2)
- vocabulary (0-2)
- spelling (0-2)

JSON: { "content": n, "form": n, "grammar": n, "vocabulary": n, "spelling": n, "overall_0_90": n, "feedback": "..." }`;
  return callClaudeJSON({ system: SYSTEM_RUBRIC, messages: [{ role: "user", content: prompt }], maxTokens: 600, temperature: 0.2 });
}

// ============== OBJECTIVE (local scoring) ==============
export function scoreMCMA(selected, correct) {
  // PTE convention: +1 for each correct selected, -1 for each incorrect selected,
  // floor at 0. Final scaled to 90 by share of correct identified.
  let raw = 0;
  for (const s of selected) {
    if (correct.includes(s)) raw += 1;
    else raw -= 1;
  }
  raw = Math.max(0, raw);
  const overall = clamp(Math.round((raw / correct.length) * 90), 0, 90);
  return {
    raw,
    maxRaw: correct.length,
    overall_0_90: overall,
    correctIndexes: correct,
  };
}

export function scoreMCSA(selectedIdx, correctIdx) {
  const correct = selectedIdx === correctIdx;
  return { correct, overall_0_90: correct ? 90 : 0 };
}

export function scoreReorder(userOrder, correctOrder) {
  // PTE: 1 point for each correctly adjacent pair.
  let pairs = 0;
  const maxPairs = correctOrder.length - 1;
  for (let i = 0; i < userOrder.length - 1; i++) {
    const a = userOrder[i], b = userOrder[i + 1];
    const aIdx = correctOrder.indexOf(a);
    const bIdx = correctOrder.indexOf(b);
    if (aIdx !== -1 && bIdx === aIdx + 1) pairs++;
  }
  return {
    pairs,
    maxPairs,
    overall_0_90: clamp(Math.round((pairs / maxPairs) * 90), 0, 90),
  };
}

export function scoreFillBlanks(answers, correct) {
  let hits = 0;
  for (let i = 0; i < correct.length; i++) {
    if ((answers[i] || "").trim().toLowerCase() === correct[i].toLowerCase()) hits++;
  }
  return {
    hits,
    total: correct.length,
    overall_0_90: clamp(Math.round((hits / correct.length) * 90), 0, 90),
  };
}

export function scoreWriteFromDictation(answer, correct) {
  // Lowercased word-by-word match; PTE awards points per correct word.
  const ans = (answer || "").toLowerCase().replace(/[.,!?;:]/g, "").split(/\s+/).filter(Boolean);
  const cor = correct.toLowerCase().replace(/[.,!?;:]/g, "").split(/\s+/).filter(Boolean);
  let hits = 0;
  const ansCopy = [...ans];
  for (const w of cor) {
    const idx = ansCopy.indexOf(w);
    if (idx !== -1) {
      hits++;
      ansCopy.splice(idx, 1);
    }
  }
  return {
    hits,
    total: cor.length,
    overall_0_90: clamp(Math.round((hits / cor.length) * 90), 0, 90),
  };
}

export function scoreHighlightIncorrectWords(flagged, actuallyWrong) {
  // +1 for each correctly flagged, -1 for each incorrectly flagged.
  let raw = 0;
  for (const f of flagged) {
    if (actuallyWrong.includes(f)) raw += 1;
    else raw -= 1;
  }
  raw = Math.max(0, raw);
  return {
    raw,
    maxRaw: actuallyWrong.length,
    overall_0_90: clamp(Math.round((raw / Math.max(1, actuallyWrong.length)) * 90), 0, 90),
    correctIndexes: actuallyWrong,
  };
}
