// Score history — persisted to localStorage so progress survives sessions.
// Each entry: { taskId, taskName, section, overall, timestamp }

import { getTaskMeta } from "./content.js";

const KEY = "pte_history_v1";
const MAX_ENTRIES = 1000; // safety bound

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch (e) {
    return [];
  }
}

function save(arr) {
  if (arr.length > MAX_ENTRIES) arr = arr.slice(-MAX_ENTRIES);
  localStorage.setItem(KEY, JSON.stringify(arr));
}

export function addScore(taskId, score) {
  const overall = score?.overall_0_90;
  if (overall == null || isNaN(overall)) return;
  const meta = getTaskMeta(taskId);
  const entry = {
    taskId,
    taskName: meta?.name || taskId,
    section: meta?.section || "Other",
    overall: Math.round(overall),
    timestamp: Date.now(),
  };
  const arr = load();
  arr.push(entry);
  save(arr);
}

export function getAll() {
  return load();
}

export function clearAll() {
  localStorage.removeItem(KEY);
}

// Per-task aggregates: count, mean, best, last score.
export function summary() {
  const arr = load();
  const groups = {};
  for (const e of arr) {
    if (!groups[e.taskId]) {
      groups[e.taskId] = {
        taskId: e.taskId,
        taskName: e.taskName,
        section: e.section,
        scores: [],
      };
    }
    groups[e.taskId].scores.push({ overall: e.overall, timestamp: e.timestamp });
  }
  return Object.values(groups).map((g) => {
    const scores = g.scores.map((s) => s.overall);
    const last = g.scores[g.scores.length - 1];
    return {
      taskId: g.taskId,
      taskName: g.taskName,
      section: g.section,
      count: scores.length,
      mean: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
      best: Math.max(...scores),
      worst: Math.min(...scores),
      last: last.overall,
      lastTimestamp: last.timestamp,
      recent: g.scores.slice(-10), // last 10 for sparkline
    };
  });
}

// Section-level aggregates.
export function sectionSummary() {
  const arr = load();
  const groups = {};
  for (const e of arr) {
    if (!groups[e.section]) groups[e.section] = [];
    groups[e.section].push(e.overall);
  }
  return Object.entries(groups).map(([section, scores]) => ({
    section,
    count: scores.length,
    mean: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
  }));
}

// Identify weakest tasks: lowest mean among those practised at least twice.
export function weakSpots(limit = 3) {
  return summary()
    .filter((s) => s.count >= 2)
    .sort((a, b) => a.mean - b.mean)
    .slice(0, limit);
}
