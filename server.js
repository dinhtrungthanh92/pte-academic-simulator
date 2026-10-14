// PTE Academic Simulator — Render web service.
// Serves the static app + /api/score AI scoring proxy (DeepSeek cloud).
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// DeepSeek cloud. Key comes from the Render dashboard env var DEEPSEEK_API_KEY
// (render.yaml declares it with sync:false so it never lives in git).
const API_URL = process.env.SCORER_URL || 'https://api.deepseek.com/v1/chat/completions';
const API_KEY = process.env.DEEPSEEK_API_KEY || '';
const MODEL = process.env.SCORER_MODEL || 'deepseek-chat';

app.use(express.json({ limit: '8mb' }));
app.use(express.static(__dirname));

// Concatenate "data: {...}" SSE chunks; the upstream may stream even when
// stream is not requested.
function sseToText(raw) {
  const parts = [];
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s.startsWith('data:')) continue;
    const chunk = s.slice(5).trim();
    if (!chunk || chunk === '[DONE]') continue;
    try {
      const o = JSON.parse(chunk);
      const c = (o.choices || [{}])[0];
      parts.push((c.delta && c.delta.content) || (c.message && c.message.content) || '');
    } catch (_) {}
  }
  return parts.join('');
}

function stripFences(t) {
  return t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

app.post('/api/score', async (req, res) => {
  if (!API_KEY) return res.status(500).json({ error: 'DEEPSEEK_API_KEY not set on the server' });
  const { system, messages, max_tokens, temperature } = req.body || {};
  const msgs = [];
  if (system) msgs.push({ role: 'system', content: system });
  for (const m of messages || []) msgs.push({ role: m.role || 'user', content: m.content || '' });

  try {
    const r = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages: msgs,
        max_tokens: Math.max(parseInt(max_tokens, 10) || 800, 4000),
        temperature: parseFloat(temperature) || 0.2,
      }),
    });
    const raw = await r.text();
    let text = raw.includes('data:') ? sseToText(raw) : (JSON.parse(raw).choices?.[0]?.message?.content || '');
    text = stripFences(text);
    if (text && !text.startsWith('{')) {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) text = m[0];
    }
    if (!text) return res.status(502).json({ error: `scorer empty (${r.status})` });
    res.json({ content: text });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

app.listen(PORT, () => console.log(`PTE Academic Simulator on :${PORT} (scorer=${MODEL})`));
