// Smart explanation engine — produces genuinely useful, evidence-based
// explanations (grammar / word-form / meaning / logic) rather than echoing
// the passage. Built by Jason Dinh.

// Words ending in -er/-ed/-ing can be verb or comparative adj; keep suffix rule
// but the explicit wordlists above take precedence.
const POS_SUFFIX = [
  [/(tion|sion|ment|ness|ity|ance|ence|ship|hood|ism|ist|er|or|age|ure|ology|graphy)$/i, "noun"],
  [/(ous|ful|less|able|ible|ive|al|ic|ary|ent|ant)$/i, "adj"],
  [/(ly)$/i, "adv"],
  [/(ise|ize|ate|ify|ing|ed|s)$/i, "verb"],
];

const ADV_WORDS = new Set(["never","always","often","sometimes","usually","rarely","seldom","only","just","even","still","also","already","yet","ever","soon","later","now","then","here","there","well","very","quite","rather","almost","nearly","hardly","really","truly","simply","merely","mostly","partly","fully","highly","greatly","widely","rapidly","quickly","slowly","carefully","successfully","effectively","generally","particularly","especially","however","therefore","thus","moreover","furthermore","accordingly"]);
const NOUN_WORDS = new Set(["people","person","children","water","data","research","study","time","way","work","part","number","world","life","hand","place","case","week","company","system","program","question","government","night","point","home","water","room","mother","area","money","story","fact","month","lot","right","book","eye","job","word","business","issue","side","kind","head","house","service","friend","father","power","hour","game","line","end"]);

export function inferPOS(word) {
  const w = String(word || "").toLowerCase().trim();
  if (ADV_WORDS.has(w)) return "adv";
  if (NOUN_WORDS.has(w)) return "noun";
  // hyphenated compound ending in a gerund is usually a noun (decision-making)
  if (/-/.test(w) && /ing$/.test(w)) return "noun";
  for (const [re, pos] of POS_SUFFIX) if (re.test(w)) return pos;
  return null;
}

const POS_VI = { noun: "danh từ", adj: "tính từ", adv: "trạng từ", verb: "động từ" };
const DET = /\b(a|an|the|this|that|these|those|its|their|his|her|our|your|some|any|every|no|each|both|all|two|three|several|many|much|few|little)\s*$/i;
const PREP = /\b(of|in|on|at|to|for|with|from|by|about|into|through|during|between|among|across|against|without|within|upon|over|under|after|before)\s*$/i;
const AUX = /\b(is|are|was|were|be|been|being|has|have|had|will|would|can|could|may|might|must|should|do|does|did)\s*$/i;
const DEGREE = /\b(very|extremely|quite|rather|so|too|highly|more|most|really|fairly)\s*$/i;

// Decide which POS the slot requires, from immediate left context.
function neededPOS(before) {
  const b = String(before || "").trim();
  if (PREP.test(b)) return "noun";
  if (DET.test(b)) return "noun";
  if (DEGREE.test(b)) return "adj";
  if (AUX.test(b)) return null; // could be verb-ing/ed or adj
  return null;
}

const stemOf = (w) => String(w || "").toLowerCase().replace(/(ings?|ed|es|s|ly|ness|ion|ation|al|ful|less|ise|ize|ence|ance|ent|ant|ity|ment|ous|ive|able|ible)$/i, "");

// ---------- FIB explanation ----------
export function explainFillBlank({ correct, options = [], before = "", after = "" }) {
  const opts = options.filter(Boolean);
  const correctPOS = inferPOS(correct);
  const need = neededPOS(before);
  const stem = stemOf(correct);
  const stems = new Set(opts.map(stemOf));
  const beforeShort = before.trim().split(/\s+/).slice(-3).join(" ");
  const afterShort = after.trim().split(/\s+/).slice(0, 3).join(" ");

  // 1) Same stem family → word-form question (strongest signal)
  if (opts.length > 1 && stems.size === 1) {
    return `<b>Dạng từ (word form).</b> Mọi phương án đều cùng gốc “<b>${stem}</b>”, chỉ khác đuôi. `
      + `Ngữ pháp chỗ trống này cần một <b>${correctPOS ? POS_VI[correctPOS] : "dạng đúng"}</b>`
      + (need ? ` (vì đứng sau “${beforeShort}”)` : "")
      + `, nên phải chọn “<b>${correct}</b>”. `
      + `Các đuôi khác sai vì cho ra ${[...new Set(opts.filter(o=>o!==correct).map(o=>POS_VI[inferPOS(o)]||"sai dạng"))].join(" / ")}.`;
  }

  // 2) Options differ in POS → grammar decides
  const posSet = new Set(opts.map(inferPOS).filter(Boolean));
  if (posSet.size > 1 && correctPOS && need) {
    const wrongs = opts.filter((o) => o !== correct && inferPOS(o) && inferPOS(o) !== need)
      .map((o) => `“${o}” (${POS_VI[inferPOS(o)]})`);
    return `<b>Loại từ (part of speech).</b> `
      + `Đứng sau “${beforeShort}” nên chỗ trống bắt buộc là <b>${POS_VI[need]}</b>. `
      + `“<b>${correct}</b>” đúng vai trò đó.`
      + (wrongs.length ? ` Loại ${wrongs.slice(0, 3).join(", ")} — sai loại từ nên không thể điền vào.` : "");
  }

  // 3) Same POS → meaning / collocation: explain the semantic contrast, not the passage.
  const others = opts.filter((o) => o !== correct);
  const posLabel = correctPOS ? POS_VI[correctPOS] : "từ";
  return `<b>Nghĩa &amp; sắc thái.</b> Bốn phương án đều là <b>${posLabel}</b>, cùng nằm trong một nhóm nghĩa gần nhau, `
    + `nên không thể loại bằng ngữ pháp mà phải dựa vào <b>nghĩa chính xác</b> trong ngữ cảnh này. `
    + `“<b>${correct}</b>” là từ duy nhất khớp đúng <b>nghĩa &amp; cách dùng</b>; `
    + (others.length ? `các từ còn lại (${others.map((o) => `“${o}”`).slice(0, 3).join(", ")}) ` : "") 
    + `lệch nghĩa hoặc không kết hợp tự nhiên với các từ đứng cạnh chỗ trống. `
    + `<b>Mẹo:</b> với dạng này, hãy dịch nhanh cả câu để chọn từ đúng nghĩa, đừng chọn theo cảm giác “nghe quen”.`;
}

// ---------- MCQ explanation ----------
export function explainMCQ({ options, correctIdxs }) {
  const absolutes = /\b(all|always|never|every|only|must|impossible|no one|none|completely|entirely)\b/i;
  const idxs = Array.isArray(correctIdxs) ? correctIdxs : [correctIdxs];
  const parts = [];
  idxs.forEach((ci) => {
    parts.push(`“<b>${String.fromCharCode(65 + ci)}</b>” là đáp án vì nội dung của nó <b>khớp với thông tin</b> nêu trong đoạn đọc (diễn đạt lại bằng từ đồng nghĩa).`);
  });
  const distractors = options
    .map((o, i) => [o, i])
    .filter(([, i]) => !idxs.includes(i))
    .filter(([o]) => absolutes.test(o))
    .slice(0, 2)
    .map(([o, i]) => `“${String.fromCharCode(65 + i)}”`);
  let out = parts.join(" ");
  if (distractors.length) out += ` Các phương án ${distractors.join(", ")} chứa từ <b>tuyệt đối</b> (all/never/only…) — dấu hiệu đáp án nhiễu vì đoạn văn hiếm khi khẳng định tuyệt đối.`;
  out += " <b>Mẹo:</b> đáp án đúng thường <b>được nhắc lại</b> trong bài dưới dạng từ đồng nghĩa; đáp án bịa thêm chi tiết hoặc tuyệt đối hoá thường sai.";
  return out;
}

// ---------- Re-order explanation ----------
export function explainReorder(order, correctOrder, paragraphs) {
  const connector = /\b(this|these|it|they|however|therefore|thus|so|then|first|second|third|finally|in conclusion|as a result|for example|but|although|moreover|furthermore|such)\b/i;
  const notes = [];
  correctOrder.forEach((origIdx, pos) => {
    const text = paragraphs[origIdx] || "";
    const hit = text.match(connector);
    if (pos === 0) {
      notes.push(`<b>Câu 1</b> nêu ý khái quát/mở đầu (không bắt đầu bằng từ nối chỉ về trước).`);
    } else if (hit) {
      notes.push(`<b>Câu ${pos + 1}</b> mở bằng “<b>${hit[0]}</b>” → phải nối tiếp ý đã nhắc tới trước đó.`);
    }
  });
  return `<b>Mạch liên kết.</b> ` + notes.join(" ")
    + ` Quy tắc vàng: câu <b>giới thiệu khái niệm</b> đứng trước; câu dùng <b>đại từ</b> (it/they/this) hoặc <b>từ nối</b> (however/therefore) để chỉ về nó đứng sau.`;
}

// ---------- Write From Dictation ----------
export function explainWFD(correct, user) {
  const cw = String(correct).trim().split(/\s+/);
  const uw = String(user || "").trim().split(/\s+/);
  const diffs = [];
  const n = Math.max(cw.length, uw.length);
  for (let i = 0; i < n; i++) {
    const c = (cw[i] || "").replace(/[.,!?;:"]/g, "").toLowerCase();
    const u = (uw[i] || "").replace(/[.,!?;:"]/g, "").toLowerCase();
    if (c !== u) diffs.push(`từ ${i + 1}: bạn “${uw[i] || "∅"}” ≠ “<b>${cw[i] || "∅"}</b>”`);
  }
  if (!diffs.length) return "Chính xác 100% — khớp từng từ và đúng vị trí. 🎯";
  return `Khớp <b>${cw.length - diffs.length}/${cw.length}</b> từ. Sai ở: ${diffs.slice(0, 6).join("; ")}`
    + (diffs.length > 6 ? ` … (+${diffs.length - 6})` : "")
    + ". WFD chấm <b>từng từ đúng thứ tự</b> — chú ý từ chức năng (a/the/of/to), thì của động từ và đuôi số nhiều -s.";
}

// ---------- Highlight Incorrect Words ----------
export function explainHIW(wrongWords) {
  if (!wrongWords.length) return "Không có từ nào sai.";
  const list = wrongWords.map((w) => `“<b>${w}</b>”`).join(", ");
  return `Audio đọc <b>khác</b> văn bản ở: ${list}. `
    + `Đây là những từ bạn phải bấm chọn. <b>Mẹo:</b> vừa nghe vừa đọc nhẩm theo, so <b>từng từ</b>, chú ý âm cuối (-s, -ed) và các cặp từ dễ lẫn (affect/effect, than/then).`;
}

// ---------- Answer short question ----------
export function explainASQ(answer) {
  return `<b>Đáp án: “${answer}”.</b> ASQ chỉ cần trả lời <b>1–3 từ</b> trực tiếp. `
    + `Chấm dựa trên <b>từ khoá đúng</b> và độ trôi chảy; không cần câu đầy đủ đúng ngữ pháp.`;
}

// ---------- Listening FIB ----------
export function explainListeningFIB(correctArr, userArr) {
  const miss = [];
  correctArr.forEach((c, i) => {
    const u = (userArr[i] || "").trim();
    if (u.toLowerCase() !== c.toLowerCase()) miss.push(`ô ${i + 1}: đúng “<b>${c}</b>” (bạn: “${u || "∅"}”)`);
  });
  if (!miss.length) return "Điền đúng toàn bộ. 🎯";
  return `Sai ở ${miss.join("; ")}. Listening FIB chấm <b>chính tả từng ô</b> — chú ý danh từ số nhiều (-s) và đuôi động từ (-ed/-ing).`;
}
