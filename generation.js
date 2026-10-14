// AI-powered item generation. Each task type has a generator that asks
// Claude to produce a single item matching the existing schema. Items are
// persisted in localStorage and mixed into the random pool used by tasks.js.

import { callClaudeJSON } from "./api.js";

const STORAGE_KEY = "pte_generated_v1";

function loadAll() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
  catch (e) { return {}; }
}
function saveAll(map) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function getGeneratedFor(taskId) {
  return loadAll()[taskId] || [];
}

export function generatedCount(taskId) {
  return getGeneratedFor(taskId).length;
}

export function clearGenerated(taskId) {
  const all = loadAll();
  if (taskId) delete all[taskId]; else Object.keys(all).forEach((k) => delete all[k]);
  saveAll(all);
}

const SYSTEM = "You generate PTE Academic-style practice items. The PTE is an academic English test. Topics should be academic but accessible (science, history, environment, technology, society, economics). Avoid culturally sensitive or political topics. Output only valid JSON, no markdown fences, no commentary.";

const GENERATORS = {
  readAloud: () => callClaudeJSON({
    system: SYSTEM,
    messages: [{ role: "user", content: `Generate one Read Aloud passage for PTE.
Requirements: 35-50 words, academic register, complete sentences, varied vocabulary.
Schema: {"text": "..."}
Return only JSON.` }],
    maxTokens: 400, temperature: 0.9,
  }),

  repeatSentence: async () => {
    const r = await callClaudeJSON({
      system: SYSTEM,
      messages: [{ role: "user", content: `Generate one Repeat Sentence item for PTE.
Requirements: 10-15 words, single complete sentence on an academic/university topic.
Schema: {"sentence": "..."}
Return only JSON.` }],
      maxTokens: 200, temperature: 0.9,
    });
    return r.sentence;
  },

  describeImage: () => callClaudeJSON({
    system: SYSTEM,
    messages: [{ role: "user", content: `Generate one chart spec for PTE Describe Image.
Pick ONE type at random: "bar", "line", "pie", "table", "process", "map", "comboBarLine".
Schemas:
- bar/line: {"type":"bar"|"line","title":"...","data":[{"label":"...","value":N},...5-6 items],"yLabel":"..."}
- pie: {"type":"pie","title":"...","data":[{"label":"...","value":N},...5-6 items totaling 100]}
- table: {"type":"table","title":"...","columns":["c1","c2","c3","c4"],"rows":[[r1c1,r1c2,...],...4-5 rows of strings]}
- process: {"type":"process","title":"...","steps":["step 1","step 2",...4-5 short steps]}
- map: {"type":"map","title":"...","regions":[{"region":"NSW","value":N},...use AU states: NSW,VIC,QLD,WA,SA,TAS,NT,ACT],"unit":"M"|"mm"|""}
- comboBarLine: {"type":"comboBarLine","title":"...","barLabel":"...","lineLabel":"...","yLabel":"...","data":[{"label":"2020","bar":N,"line":N},...5-6 items]}
Pick an academic topic. Return only JSON.` }],
    maxTokens: 600, temperature: 1.0,
  }),

  retellLecture: () => callClaudeJSON({
    system: SYSTEM,
    messages: [{ role: "user", content: `Generate one Re-tell Lecture item for PTE.
Requirements: 90-130 word academic mini-lecture on a single topic with 3-4 main points.
Schema: {"title":"short topic name", "transcript":"the spoken text..."}
Return only JSON.` }],
    maxTokens: 500, temperature: 0.9,
  }),

  answerShortQuestion: () => callClaudeJSON({
    system: SYSTEM,
    messages: [{ role: "user", content: `Generate one PTE Answer Short Question.
Requirements: a clear factual question with a 1-3 word answer (general knowledge / science / vocab).
Schema: {"q":"the question?", "a":["accepted answer 1","accepted answer 2 if synonyms exist"]}
Return only JSON.` }],
    maxTokens: 200, temperature: 0.9,
  }),

  summarizeWrittenText: () => callClaudeJSON({
    system: SYSTEM,
    messages: [{ role: "user", content: `Generate one PTE Summarize Written Text passage.
Requirements: 200-280 words, academic register, single coherent topic with several supporting points so a summary captures the gist.
Schema: {"text":"..."}
Return only JSON.` }],
    maxTokens: 1000, temperature: 0.8,
  }),

  writeEssay: async () => {
    const r = await callClaudeJSON({
      system: SYSTEM,
      messages: [{ role: "user", content: `Generate one PTE Write Essay prompt.
Requirements: 1-2 sentence prompt that invites a 200-300 word academic essay; uses a "discuss / agree-disagree / advantages-disadvantages" structure.
Schema: {"prompt":"..."}
Return only JSON.` }],
      maxTokens: 200, temperature: 0.9,
    });
    return r.prompt;
  },

  readingFillBlanksRW: () => callClaudeJSON({
    system: SYSTEM,
    messages: [{ role: "user", content: `Generate one PTE Reading & Writing Fill in Blanks item.
Requirements: an academic paragraph (~60-90 words) with 3-4 blanks. Each blank has 4 same-part-of-speech options; only one is correct.
Output JSON schema:
{"text":[
  "...prose segment...",
  {"blank":0,"correct":"X","options":["X","Y","Z","W"]},
  "...prose...",
  {"blank":1,"correct":"A","options":["A","B","C","D"]},
  "...prose..."
]}
Return only JSON.` }],
    maxTokens: 800, temperature: 0.8,
  }),

  readingMCMA: () => callClaudeJSON({
    system: SYSTEM,
    messages: [{ role: "user", content: `Generate one PTE Reading Multiple-Choice Multiple-Answers item.
Requirements: 100-150 word academic passage + 1 question. 5 options. 2-3 should be correct (must be defensible from the passage).
Schema: {"passage":"...","question":"...","options":["o1","o2","o3","o4","o5"],"correct":[0,2]}
Return only JSON.` }],
    maxTokens: 700, temperature: 0.8,
  }),

  reorderParagraphs: () => callClaudeJSON({
    system: SYSTEM,
    messages: [{ role: "user", content: `Generate one PTE Re-order Paragraphs item.
Requirements: 4 paragraphs (1-2 sentences each) on a single academic topic. They should form a clearly correct sequence (e.g. introduction → development → consequence → resolution). The paragraphs array is in the CORRECT order.
Schema: {"paragraphs":["p1","p2","p3","p4"]}
Return only JSON.` }],
    maxTokens: 600, temperature: 0.8,
  }),

  readingFillBlanks: () => callClaudeJSON({
    system: SYSTEM,
    messages: [{ role: "user", content: `Generate one PTE Reading Fill in Blanks (drag-and-drop) item.
Requirements: 3-4 academic-paragraph blanks. "bank" contains correct words + 3-4 distractors. "text" is an array of strings and blank markers.
Schema:
{"text":[
  "prose segment...",
  {"blank":0},
  "more prose...",
  {"blank":1},
  "more prose..."
],
 "correct":["word1","word2","word3"],
 "bank":["word1","word2","word3","distractor1","distractor2"]}
Return only JSON.` }],
    maxTokens: 700, temperature: 0.8,
  }),

  readingMCSA: () => callClaudeJSON({
    system: SYSTEM,
    messages: [{ role: "user", content: `Generate one PTE Reading Multiple-Choice Single-Answer item.
Requirements: 80-120 word academic passage + 1 question. 4 options, exactly 1 correct.
Schema: {"passage":"...","question":"...","options":["o1","o2","o3","o4"],"correct":2}
Return only JSON.` }],
    maxTokens: 600, temperature: 0.8,
  }),

  summarizeSpokenText: () => callClaudeJSON({
    system: SYSTEM,
    messages: [{ role: "user", content: `Generate one PTE Summarize Spoken Text transcript.
Requirements: 110-150 word academic mini-lecture on a single topic with 3-4 key points (suitable for being summarised in 50-70 words).
Schema: {"title":"short topic","transcript":"the spoken text..."}
Return only JSON.` }],
    maxTokens: 600, temperature: 0.8,
  }),

  listeningMCMA: () => callClaudeJSON({
    system: SYSTEM,
    messages: [{ role: "user", content: `Generate one PTE Listening Multiple-Choice Multiple-Answers item.
Requirements: 100-150 word academic transcript + 1 question. 5 options. 2-3 correct.
Schema: {"title":"short topic","transcript":"...","question":"...","options":["o1","o2","o3","o4","o5"],"correct":[0,2,3]}
Return only JSON.` }],
    maxTokens: 700, temperature: 0.8,
  }),

  listeningFillBlanks: () => callClaudeJSON({
    system: SYSTEM,
    messages: [{ role: "user", content: `Generate one PTE Listening Fill in Blanks item.
Requirements: 70-100 word academic transcript that will be spoken aloud. A "template" of the same text with 3 specific content words replaced by "_____". The "correct" array has the 3 words in order.
Schema: {"title":"...","transcript":"the FULL spoken text...","template":"text with _____ in 3 places","correct":["word1","word2","word3"]}
Return only JSON.` }],
    maxTokens: 600, temperature: 0.8,
  }),

  highlightCorrectSummary: () => callClaudeJSON({
    system: SYSTEM,
    messages: [{ role: "user", content: `Generate one PTE Highlight Correct Summary item.
Requirements: 90-130 word academic transcript + 4 candidate summaries. Exactly 1 captures the main idea accurately. The other 3 should be wrong in subtle ways (partial truth, wrong emphasis, contradicts a detail, etc).
Schema: {"title":"...","transcript":"...","options":["good summary","wrong 1","wrong 2","wrong 3"],"correct":0}
Return only JSON.` }],
    maxTokens: 700, temperature: 0.8,
  }),

  listeningMCSA: () => callClaudeJSON({
    system: SYSTEM,
    messages: [{ role: "user", content: `Generate one PTE Listening Multiple-Choice Single-Answer item.
Requirements: 80-120 word academic transcript + 1 question. 4 options, 1 correct.
Schema: {"title":"...","transcript":"...","question":"...","options":["o1","o2","o3","o4"],"correct":1}
Return only JSON.` }],
    maxTokens: 600, temperature: 0.8,
  }),

  selectMissingWord: () => callClaudeJSON({
    system: SYSTEM,
    messages: [{ role: "user", content: `Generate one PTE Select Missing Word item.
Requirements: 80-110 word academic transcript that ends mid-thought (the last word missing). 4 plausible options; only 1 fits naturally based on context.
Schema: {"title":"...","transcript":"the transcript ending right before the missing word","options":["correct","plausible 1","plausible 2","plausible 3"],"correct":0}
Return only JSON.` }],
    maxTokens: 500, temperature: 0.9,
  }),

  highlightIncorrectWords: () => callClaudeJSON({
    system: SYSTEM,
    messages: [{ role: "user", content: `Generate one PTE Highlight Incorrect Words item.
Requirements: An 80-120 word academic transcript. Then a "display" version of the same text where 4-6 words are replaced with plausible-looking substitutes (same part of speech, similar meaning). Words must be aligned 1-to-1 — same word count, only some words changed.
Schema: {"title":"...","spoken":"the SPOKEN version (correct)","display":"the DISPLAY version (with substitutions)"}
Return only JSON. Make sure word count in spoken === word count in display.` }],
    maxTokens: 700, temperature: 0.8,
  }),

  writeFromDictation: async () => {
    const r = await callClaudeJSON({
      system: SYSTEM,
      messages: [{ role: "user", content: `Generate one PTE Write from Dictation sentence.
Requirements: 10-14 words, academic register, common but slightly varied vocabulary, complete sentence.
Schema: {"sentence":"..."}
Return only JSON.` }],
      maxTokens: 200, temperature: 0.9,
    });
    return r.sentence;
  },
};

export async function generateForTask(taskId) {
  const fn = GENERATORS[taskId];
  if (!fn) throw new Error(`Generation not supported for "${taskId}" yet.`);
  const item = await fn();
  const all = loadAll();
  if (!all[taskId]) all[taskId] = [];
  all[taskId].push(item);
  saveAll(all);
  return item;
}

export function hasGenerator(taskId) {
  return !!GENERATORS[taskId];
}
