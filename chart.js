// Minimal inline-SVG chart renderer for Describe Image tasks.

const W = 480;
const H = 320;
const PAD = { top: 36, right: 20, bottom: 60, left: 50 };

function escapeXml(s) {
  return String(s).replace(/[<>&"]/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;",
  }[c]));
}

export function renderChart(spec) {
  if (spec.type === "bar") return renderBar(spec);
  if (spec.type === "line") return renderLine(spec);
  if (spec.type === "pie") return renderPie(spec);
  if (spec.type === "table") return renderTable(spec);
  if (spec.type === "process") return renderProcess(spec);
  if (spec.type === "map") return renderMap(spec);
  if (spec.type === "comboBarLine") return renderComboBarLine(spec);
  return "";
}

function renderBar({ title, data, yLabel }) {
  const max = Math.max(...data.map((d) => d.value));
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;
  const barW = (chartW / data.length) * 0.7;
  const gap = (chartW / data.length) * 0.3;
  const yTicks = 5;

  const bars = data.map((d, i) => {
    const x = PAD.left + i * (barW + gap) + gap / 2;
    const h = (d.value / max) * chartH;
    const y = PAD.top + chartH - h;
    return `
      <rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="#00a8cc" />
      <text x="${x + barW / 2}" y="${PAD.top + chartH + 16}" text-anchor="middle" font-size="11" fill="#444">${escapeXml(d.label)}</text>
      <text x="${x + barW / 2}" y="${y - 4}" text-anchor="middle" font-size="11" fill="#333">${d.value}</text>
    `;
  }).join("");

  const yAxis = Array.from({ length: yTicks + 1 }).map((_, i) => {
    const v = Math.round((max * i) / yTicks);
    const y = PAD.top + chartH - (i / yTicks) * chartH;
    return `
      <line x1="${PAD.left}" y1="${y}" x2="${PAD.left + chartW}" y2="${y}" stroke="#eee" />
      <text x="${PAD.left - 6}" y="${y + 3}" text-anchor="end" font-size="10" fill="#777">${v}</text>
    `;
  }).join("");

  return `
    <svg class="chart-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      <text x="${W / 2}" y="20" text-anchor="middle" font-size="14" font-weight="600" fill="#003459">${escapeXml(title)}</text>
      ${yLabel ? `<text x="14" y="${H / 2}" text-anchor="middle" font-size="11" fill="#555" transform="rotate(-90 14 ${H / 2})">${escapeXml(yLabel)}</text>` : ""}
      ${yAxis}
      ${bars}
      <line x1="${PAD.left}" y1="${PAD.top + chartH}" x2="${PAD.left + chartW}" y2="${PAD.top + chartH}" stroke="#333" />
      <line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top + chartH}" stroke="#333" />
    </svg>
  `;
}

function renderLine({ title, data, yLabel }) {
  const vals = data.map((d) => d.value);
  const max = Math.max(...vals);
  const min = Math.min(0, Math.min(...vals));
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const points = data.map((d, i) => {
    const x = PAD.left + (i / (data.length - 1)) * chartW;
    const y = PAD.top + chartH - ((d.value - min) / (max - min)) * chartH;
    return { x, y, ...d };
  });

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const dots = points.map((p) => `
    <circle cx="${p.x}" cy="${p.y}" r="4" fill="#00a8cc" />
    <text x="${p.x}" y="${p.y - 8}" text-anchor="middle" font-size="10" fill="#333">${p.value}</text>
    <text x="${p.x}" y="${PAD.top + chartH + 16}" text-anchor="middle" font-size="11" fill="#444">${escapeXml(p.label)}</text>
  `).join("");

  return `
    <svg class="chart-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      <text x="${W / 2}" y="20" text-anchor="middle" font-size="14" font-weight="600" fill="#003459">${escapeXml(title)}</text>
      ${yLabel ? `<text x="14" y="${H / 2}" text-anchor="middle" font-size="11" fill="#555" transform="rotate(-90 14 ${H / 2})">${escapeXml(yLabel)}</text>` : ""}
      <line x1="${PAD.left}" y1="${PAD.top + chartH}" x2="${PAD.left + chartW}" y2="${PAD.top + chartH}" stroke="#333" />
      <line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top + chartH}" stroke="#333" />
      <path d="${path}" stroke="#00a8cc" stroke-width="2" fill="none" />
      ${dots}
    </svg>
  `;
}

function renderPie({ title, data }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const cx = W / 2;
  const cy = H / 2 + 10;
  const r = 110;
  const colors = ["#00a8cc", "#003459", "#f7c844", "#2e8b57", "#c0392b", "#7d3c98", "#5d6d7e"];

  let acc = 0;
  const slices = data.map((d, i) => {
    const start = (acc / total) * Math.PI * 2 - Math.PI / 2;
    acc += d.value;
    const end = (acc / total) * Math.PI * 2 - Math.PI / 2;
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const large = end - start > Math.PI ? 1 : 0;
    const path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;

    // Label position
    const mid = (start + end) / 2;
    const lx = cx + (r + 24) * Math.cos(mid);
    const ly = cy + (r + 24) * Math.sin(mid);
    const pct = Math.round((d.value / total) * 100);

    return `
      <path d="${path}" fill="${colors[i % colors.length]}" stroke="white" stroke-width="2" />
      <text x="${lx}" y="${ly}" text-anchor="middle" font-size="11" fill="#333">${escapeXml(d.label)} (${pct}%)</text>
    `;
  }).join("");

  return `
    <svg class="chart-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      <text x="${W / 2}" y="20" text-anchor="middle" font-size="14" font-weight="600" fill="#003459">${escapeXml(title)}</text>
      ${slices}
    </svg>
  `;
}

// ---- Table ----
function renderTable({ title, columns, rows }) {
  const colW = (W - 40) / columns.length;
  const rowH = 28;
  const headerY = 50;
  const startY = headerY + rowH;

  const headerCells = columns.map((c, i) => `
    <rect x="${20 + i * colW}" y="${headerY - rowH + 6}" width="${colW}" height="${rowH}" fill="#003459" />
    <text x="${20 + i * colW + colW / 2}" y="${headerY - 2}" text-anchor="middle" font-size="11" fill="white" font-weight="600">${escapeXml(c)}</text>
  `).join("");

  const bodyCells = rows.map((row, r) => row.map((cell, c) => `
    <rect x="${20 + c * colW}" y="${startY + r * rowH - rowH + 6}" width="${colW}" height="${rowH}" fill="${r % 2 ? "#f4f8fa" : "white"}" stroke="#d6dde2" />
    <text x="${20 + c * colW + colW / 2}" y="${startY + r * rowH - 2}" text-anchor="middle" font-size="11" fill="#333">${escapeXml(cell)}</text>
  `).join("")).join("");

  return `
    <svg class="chart-svg" viewBox="0 0 ${W} ${Math.max(H, startY + rows.length * rowH + 20)}" xmlns="http://www.w3.org/2000/svg">
      <text x="${W / 2}" y="20" text-anchor="middle" font-size="14" font-weight="600" fill="#003459">${escapeXml(title)}</text>
      ${headerCells}
      ${bodyCells}
    </svg>
  `;
}

// ---- Process flowchart (sequential boxes with arrows) ----
function renderProcess({ title, steps }) {
  const n = steps.length;
  const boxW = (W - 60) / n;
  const boxH = 60;
  const y = 130;

  const items = steps.map((s, i) => {
    const x = 30 + i * boxW;
    const arrow = i < n - 1 ? `
      <line x1="${x + boxW - 10}" y1="${y + boxH / 2}" x2="${x + boxW}" y2="${y + boxH / 2}" stroke="#003459" stroke-width="2" />
      <polygon points="${x + boxW},${y + boxH / 2} ${x + boxW - 6},${y + boxH / 2 - 4} ${x + boxW - 6},${y + boxH / 2 + 4}" fill="#003459" />
    ` : "";
    // simple word-wrap: split into ~12-char chunks
    const lines = wordWrap(s, 16);
    const textLines = lines.map((ln, j) =>
      `<text x="${x + boxW / 2 - 4}" y="${y + 20 + j * 14}" text-anchor="middle" font-size="11" fill="#003459">${escapeXml(ln)}</text>`
    ).join("");
    return `
      <rect x="${x}" y="${y}" width="${boxW - 10}" height="${boxH}" rx="4" fill="white" stroke="#003459" stroke-width="2" />
      ${textLines}
      <circle cx="${x + 12}" cy="${y + 12}" r="8" fill="#00a8cc" />
      <text x="${x + 12}" y="${y + 16}" text-anchor="middle" font-size="11" fill="white" font-weight="600">${i + 1}</text>
      ${arrow}
    `;
  }).join("");

  return `
    <svg class="chart-svg" viewBox="0 0 ${W} 280" xmlns="http://www.w3.org/2000/svg">
      <text x="${W / 2}" y="24" text-anchor="middle" font-size="14" font-weight="600" fill="#003459">${escapeXml(title)}</text>
      ${items}
    </svg>
  `;
}

function wordWrap(text, maxChars) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = (cur ? cur + " " : "") + w;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

// ---- Map (Australia simplified — states as labeled circles sized by value) ----
function renderMap({ title, regions, unit = "" }) {
  // Approximate normalized positions for Australian states (0-1 in W/H).
  const positions = {
    WA: { x: 0.2, y: 0.55 },
    NT: { x: 0.42, y: 0.32 },
    SA: { x: 0.45, y: 0.65 },
    QLD: { x: 0.68, y: 0.4 },
    NSW: { x: 0.75, y: 0.65 },
    VIC: { x: 0.7, y: 0.8 },
    TAS: { x: 0.72, y: 0.94 },
    ACT: { x: 0.77, y: 0.7 },
  };
  const max = Math.max(...regions.map((r) => r.value));

  const circles = regions.map((r) => {
    const pos = positions[r.region] || { x: 0.5, y: 0.5 };
    const cx = pos.x * W;
    const cy = pos.y * 240 + 40;
    const radius = 10 + (r.value / max) * 30;
    return `
      <circle cx="${cx}" cy="${cy}" r="${radius}" fill="#00a8cc" fill-opacity="0.55" stroke="#003459" stroke-width="1.5" />
      <text x="${cx}" y="${cy - radius - 3}" text-anchor="middle" font-size="11" font-weight="600" fill="#003459">${escapeXml(r.region)}</text>
      <text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="11" fill="#003459">${r.value}${escapeXml(unit)}</text>
    `;
  }).join("");

  // Rough Australia outline (very stylised — not geographically accurate)
  const outline = `
    <path d="M 80 130 Q 60 160 90 200 Q 100 230 130 260 Q 200 290 290 280 Q 360 270 400 230 Q 420 200 400 160 Q 380 130 340 110 Q 280 90 220 100 Q 150 110 80 130 Z"
          fill="#f4f8fa" stroke="#aab5bd" stroke-width="1.5" />
  `;

  return `
    <svg class="chart-svg" viewBox="0 0 ${W} 320" xmlns="http://www.w3.org/2000/svg">
      <text x="${W / 2}" y="20" text-anchor="middle" font-size="14" font-weight="600" fill="#003459">${escapeXml(title)}</text>
      ${outline}
      ${circles}
    </svg>
  `;
}

// ---- Combo bar + line ----
function renderComboBarLine({ title, data, barLabel, lineLabel, yLabel }) {
  const barMax = Math.max(...data.map((d) => d.bar));
  const lineMax = Math.max(...data.map((d) => d.line));
  const chartW = W - PAD.left - PAD.right - 20;
  const chartH = H - PAD.top - PAD.bottom;
  const barW = (chartW / data.length) * 0.6;
  const gap = (chartW / data.length) * 0.4;

  const bars = data.map((d, i) => {
    const x = PAD.left + i * (barW + gap) + gap / 2;
    const h = (d.bar / barMax) * chartH;
    const y = PAD.top + chartH - h;
    return `
      <rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="#00a8cc" />
      <text x="${x + barW / 2}" y="${PAD.top + chartH + 16}" text-anchor="middle" font-size="11" fill="#444">${escapeXml(d.label)}</text>
    `;
  }).join("");

  const linePts = data.map((d, i) => {
    const x = PAD.left + i * (barW + gap) + gap / 2 + barW / 2;
    const y = PAD.top + chartH - (d.line / lineMax) * chartH;
    return { x, y, val: d.line };
  });
  const linePath = linePts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const dots = linePts.map((p) =>
    `<circle cx="${p.x}" cy="${p.y}" r="4" fill="#c0392b" />
     <text x="${p.x}" y="${p.y - 8}" text-anchor="middle" font-size="10" fill="#c0392b">${p.val}</text>`
  ).join("");

  const legend = `
    <rect x="${W - 150}" y="34" width="12" height="12" fill="#00a8cc" />
    <text x="${W - 134}" y="44" font-size="11" fill="#333">${escapeXml(barLabel || "Bars")}</text>
    <line x1="${W - 150}" y1="60" x2="${W - 138}" y2="60" stroke="#c0392b" stroke-width="2" />
    <text x="${W - 134}" y="64" font-size="11" fill="#333">${escapeXml(lineLabel || "Line")}</text>
  `;

  return `
    <svg class="chart-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      <text x="${W / 2}" y="20" text-anchor="middle" font-size="14" font-weight="600" fill="#003459">${escapeXml(title)}</text>
      ${yLabel ? `<text x="14" y="${H / 2}" text-anchor="middle" font-size="11" fill="#555" transform="rotate(-90 14 ${H / 2})">${escapeXml(yLabel)}</text>` : ""}
      <line x1="${PAD.left}" y1="${PAD.top + chartH}" x2="${PAD.left + chartW}" y2="${PAD.top + chartH}" stroke="#333" />
      <line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top + chartH}" stroke="#333" />
      ${bars}
      <path d="${linePath}" stroke="#c0392b" stroke-width="2" fill="none" />
      ${dots}
      ${legend}
    </svg>
  `;
}

export function describeChartData(spec) {
  if (spec.type === "image") {
    return spec.sampleAudioTranscript || spec.answer || spec.title || "An image depicting information for PTE Describe Image.";
  }
  if (spec.type === "bar" || spec.type === "line") {
    const parts = spec.data.map((d) => `${d.label}: ${d.value}`).join(", ");
    return `${spec.type} chart titled "${spec.title}". Values: ${parts}.`;
  }
  if (spec.type === "pie") {
    const parts = spec.data.map((d) => `${d.label} ${d.value}%`).join(", ");
    return `Pie chart titled "${spec.title}". Segments: ${parts}.`;
  }
  if (spec.type === "table") {
    return `Table titled "${spec.title}". Columns: ${spec.columns.join(" | ")}. Rows: ${spec.rows.map((r) => r.join(" / ")).join("; ")}.`;
  }
  if (spec.type === "process") {
    return `Process diagram titled "${spec.title}". Sequential steps: ${spec.steps.map((s, i) => `(${i + 1}) ${s}`).join(" → ")}.`;
  }
  if (spec.type === "map") {
    const parts = spec.regions.map((r) => `${r.region}: ${r.value}${spec.unit || ""}`).join(", ");
    return `Map of Australia titled "${spec.title}". Regional values: ${parts}.`;
  }
  if (spec.type === "comboBarLine") {
    const parts = spec.data.map((d) => `${d.label} (bar=${d.bar}, line=${d.line})`).join(", ");
    return `Combo bar+line chart titled "${spec.title}". Bars show ${spec.barLabel}, line shows ${spec.lineLabel}. Values: ${parts}.`;
  }
  return JSON.stringify(spec);
}
