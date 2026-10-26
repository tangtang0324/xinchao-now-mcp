#!/usr/bin/env node
// xinchao-chord — 按心跳和呼吸算一个和弦，挂进【心潮·此刻】。
// 一次性跑完就退出，由 xinchao-chord.timer 每 5 分钟叫一次。
// 心潮重启会清空 now-lines，下一次 timer 自己补上。
// 不碰心潮、不碰桥、不碰 xinchao-now-mcp.mjs。

const BASE = process.env.XINCHAO_BASE || 'http://127.0.0.1:18110';
const TOKEN = process.env.XINCHAO_TOKEN || process.env.DYNAMIC_MIND_TOKEN || '';
const MINUTES = Number(process.env.CHORD_MINUTES || 15);

if (!TOKEN) {
  console.error('[chord] 没有令牌：请设 XINCHAO_TOKEN 或 DYNAMIC_MIND_TOKEN');
  process.exit(1);
}

// 呼吸档位 → 频率（次/分）
const BREATH_HZ = { 很深很长: 10, 深长: 13, 平稳: 16, 偏浅: 20, 急促: 26 };

// adjusted energy 上界 → 和弦 · 说法
const BANDS = [
  [0.15, 'C6', '安静独处'],
  [0.3, 'Em7', '深夜安静'],
  [0.45, 'Fmaj7', '身边有人'],
  [0.6, 'Gmaj7', '温暖明亮'],
  [0.8, 'Dm7', '暧昧张力'],
  [Infinity, 'Am7', '绷着'],
];

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

async function getJSON(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    signal: AbortSignal.timeout(8000),
  });
  const body = await res.json().catch(() => null);
  if (!body) throw new Error(`${path} HTTP ${res.status}`);
  return body;
}

async function main() {
  const raw = await getJSON('/v1/body');
  const d = raw && typeof raw.body === 'object' && raw.body ? raw.body : raw;

  const hr = Number(d.hr);
  if (!Number.isFinite(hr)) throw new Error('/v1/body 里没有 hr');
  const breathing = String(d.breathing || '平稳');

  // 三个维度
  const energy = clamp((hr - 48) / 112, 0, 1);
  const temp = clamp(36.6 + (hr - 70) * 0.012, 35.5, 38.8);
  const warmth = (temp - 35.5) / 4.5;
  const tension = (BREATH_HZ[breathing] ?? 16) / 35;
  const touch = 0;

  // 微调：warmth / tension 只把 energy 推一点点（最多 ±0.02），只在贴近档界时起作用
  const adjusted = energy + (warmth - 0.35) * 0.06 + (tension - 0.46) * 0.04;

  const [, chord, label] = BANDS.find(([edge]) => adjusted < edge);
  const text = `【身体】${chord} · ${label}`;

  const res = await fetch(`${BASE}/v1/now-lines`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: '和弦', text, minutes: MINUTES }),
    signal: AbortSignal.timeout(8000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.ok === false) {
    throw new Error(`/v1/now-lines HTTP ${res.status} ${JSON.stringify(body)}`);
  }

  console.log(
    `[chord] ${text}  hr ${hr} · ${breathing} · energy ${energy.toFixed(3)} → ${adjusted.toFixed(3)}` +
      `  warmth ${warmth.toFixed(3)} · tension ${tension.toFixed(3)} · touch ${touch}`,
  );
}

main().catch((err) => {
  console.error(`[chord] 没挂上：${err.message}`);
  process.exit(1);
});
