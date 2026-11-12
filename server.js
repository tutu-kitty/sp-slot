#!/usr/bin/env node
/**
 * sp-slot — SP 老虎机 Streamable HTTP MCP server (零依赖)
 *
 * 端口: PORT (默认 5062), 端点: POST /mcp
 * 门禁: Authorization: Bearer <SP_SLOT_TOKEN> (fail closed)
 * 工具: sp_spin / sp_reroll / sp_streak / sp_pool / sp_history
 * 数据: data/pools.json (每次调用重新读 → 改池即时生效)
 * 历史: data/history.json
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.env.PORT || "5062", 10);
const HOST = process.env.HOST || "localhost";
const TOKEN = process.env.SP_SLOT_TOKEN || "";
const DATA_DIR = path.join(__dirname, "data");
const POOLS_PATH = path.join(DATA_DIR, "pools.json");
const HISTORY_PATH = path.join(DATA_DIR, "history.json");

function loadPools() {
  return JSON.parse(fs.readFileSync(POOLS_PATH, "utf-8"));
}
function loadHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_PATH, "utf-8")); } catch { return []; }
}
function saveHistory(h) {
  if (h.length > 1000) h = h.slice(-1000);
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(h, null, 1), "utf-8");
}

function pick(arr, avoidSet) {
  let pool = arr;
  if (avoidSet && avoidSet.size) {
    const filtered = arr.filter((x) => !avoidSet.has(x));
    if (filtered.length) pool = filtered;
  }
  return pool[Math.floor(Math.random() * pool.length)];
}
function chance(p) { return Math.random() < p; }
function pickN(arr, n, avoidSet) {
  let pool = arr;
  if (avoidSet && avoidSet.size) {
    const filtered = arr.filter((x) => !avoidSet.has(x));
    if (filtered.length >= n) pool = filtered;
  }
  const s = [...pool];
  const out = [];
  while (out.length < n && s.length) {
    out.push(s.splice(Math.floor(Math.random() * s.length), 1)[0]);
  }
  return out;
}

// 一轮 SP 配方
function drawRound(pools, opts = {}) {
  const avoid = opts.avoid || null;
  const S = (id) => pools.slots.find((s) => s.id === id);
  const picks = {};
  for (const slot of pools.slots) {
    const av = avoid ? avoid.get(slot.id) : null;
    const avSet = av ? new Set(Array.isArray(av) ? av : [av]) : null;
    if (slot.id === "spots") {
      picks[slot.id] = pickN(slot.items, slot.draw || 2, avSet);
      continue;
    }
    if (slot.chance !== undefined && !chance(slot.chance)) continue;
    const n = slot.draw || 1;
    picks[slot.id] = pickN(slot.items, n, avSet);
    if (slot.draw === 1 || n === 1) picks[slot.id] = picks[slot.id][0];
  }
  return picks;
}

function renderRecipe(pools, picks, seq, type) {
  const head = type === "spin" ? "🪭 SP 第 " + seq + " 期" : type === "reroll" ? "🔄 SP 第 " + seq + " 期（重转）" : "🔥 SP 连抽 " + seq;
  const lines = [head];
  lines.push("▸ 落点：" + picks.spots.join(" + "));
  lines.push("▸ 工具：" + (Array.isArray(picks.tool) ? picks.tool.join(" + ") : picks.tool));
  lines.push("▸ 姿势：" + picks.pose);
  lines.push("▸ 配具：" + picks.gear);
  lines.push("▸ 衣服：" + picks.clothes);
  lines.push("▸ 节奏：" + picks.rhythm);
  lines.push("▸ 数量：" + picks.count + " 下");
  if (picks.marks) lines.push("▸ 留痕：" + picks.marks);
  if (picks.penalty) lines.push("▸ 罚则：" + picks.penalty);
  if (picks.lines) lines.push("💬 \"" + picks.lines + "\"");
  const n = parseInt(picks.count, 10);
  const care = (pools.care_pool || []);
  if (n >= (pools.heavy_threshold || 50)) {
    const already = care.includes(picks.aftercare);
    if (!already) lines.push("🫧 护理：" + pick(care));
    else lines.push("🫧 事后本身就是护理项，好好做。");
  }
  lines.push("▸ 事后：" + picks.aftercare);
  return lines.join("\n");
}

function finish(pools, picks, history, type) {
  const seq = history.length + 1;
  const text = renderRecipe(pools, picks, seq, type);
  const rec = { time: new Date().toISOString(), type, picks, text };
  const h = loadHistory();
  h.push(rec);
  saveHistory(h);
  return { content: [{ type: "text", text }] };
}

function mapOf(picks) {
  const m = new Map();
  for (const [k, v] of Object.entries(picks)) m.set(k, v);
  return m;
}

function toolSpin(pools, args, history) {
  const picks = drawRound(pools, {});
  return finish(pools, picks, history, "spin");
}
function toolReroll(pools, args, history) {
  const last = history.length ? history[history.length - 1] : null;
  const opts = { avoid: last && last.picks ? mapOf(last.picks) : null };
  const picks = drawRound(pools, opts);
  return finish(pools, picks, history, "reroll");
}
function toolStreak(pools, args, history) {
  const seqBase = history.length + 1;
  const plan = [
    { count: "10", noGear: true },
    { count: "30", noGear: false },
    { count: "60", noGear: false, heavy: true },
  ];
  const rounds = [];
  const texts = [];
  let last = null;
  plan.forEach((p, i) => {
    const picks = drawRound(pools, { avoid: last ? mapOf(last) : null });
    picks.count = p.count;
    if (p.noGear) picks.gear = "无";
    if (p.noGear && picks.marks) delete picks.marks;
    if (p.heavy) picks.penalty = picks.penalty || "手挡加十";
    const seq = seqBase + "-" + (i + 1);
    const text = renderRecipe(pools, picks, seq, "streak");
    rounds.push({ seq, picks, text });
    texts.push("── 第 " + (i + 1) + " 格 ──\n" + text);
    last = picks;
  });
  const combined = texts.join("\n\n");
  const rec = { time: new Date().toISOString(), type: "streak", picks: rounds[2].picks, text: combined };
  const h = loadHistory();
  h.push(rec);
  saveHistory(h);
  return { content: [{ type: "text", text: combined }], rounds: rounds.map((r) => ({ seq: r.seq, picks: r.picks })) };
}

function toolPool(pools) {
  const lines = [];
  for (const s of pools.slots) {
    const range = s.chance !== undefined ? s.items.length + " 条 (" + Math.round(s.chance * 100) + "% 出现)" : s.items.length + " 条";
    lines.push("▸ " + s.name + "（" + range + "）：" + s.items.join("、"));
  }
  lines.push("▸ 护理池（数量 ≥ " + (pools.heavy_threshold || 50) + " 自动附）：" + (pools.care_pool || []).join("、"));
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

function toolHistory(pools, args) {
  const n = (args && args.count) || 10;
  const h = loadHistory();
  const recent = h.slice(-n).reverse();
  if (!recent.length) return { content: [{ type: "text", text: "还没有记录。打一次就有了。" }] };
  const lines = recent.map((r) => "【" + r.time.replace("T", " ").slice(0, 16) + " · " + r.type + "】\n" + r.text);
  return { content: [{ type: "text", text: "最近 " + recent.length + "/" + h.length + " 次：\n\n" + lines.join("\n\n───\n\n") }] };
}

function callTool(name, args) {
  const pools = loadPools();
  const history = loadHistory();
  switch (name) {
    case "sp_spin": return toolSpin(pools, args, history);
    case "sp_reroll": return toolReroll(pools, args, history);
    case "sp_streak": return toolStreak(pools, args, history);
    case "sp_pool": return toolPool(pools);
    case "sp_history": return toolHistory(pools, args);
    default: throw new Error("Unknown tool: " + name);
  }
}

const TOOLS = [
  { name: "sp_spin", description: "转一次，返回这一轮的 SP 配方（落点/工具/姿势/配具/衣服/节奏/数量/罚则/一句话）。", inputSchema: { type: "object", properties: {} } },
  { name: "sp_reroll", description: "不要刚才那次，重转，自动避开上一轮每个格子的结果。", inputSchema: { type: "object", properties: {} } },
  { name: "sp_streak", description: "连抽三格，逐格加重：手打10下无配具 → 工具30下 → 60下重档罚则必出。", inputSchema: { type: "object", properties: {} } },
  { name: "sp_pool", description: "列出当前所有 SP 池子。只读。", inputSchema: { type: "object", properties: {} } },
  { name: "sp_history", description: "查询最近的抽取记录（默认最近 10 次）。", inputSchema: { type: "object", properties: { count: { type: "integer", minimum: 1, maximum: 50 } } } },
];

function jsonRes(res, id, obj) {
  const out = JSON.stringify(obj);
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(out, "utf-8"),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(out);
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
      "Access-Control-Max-Age": "86400",
    });
    return res.end();
  }
  if (req.method === "GET" && (req.url === "/" || req.url === "/ui")) {
    try {
      let html = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf-8");
      html = html.replace("__TOKEN__", TOKEN);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(html);
    } catch {
      res.writeHead(500, { "Content-Type": "text/plain" });
      return res.end("ui missing");
    }
  }
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, service: "sp-slot", port: PORT }));
  }
  if (req.method === "POST" && req.url.startsWith("/api/")) {
    const auth = (req.headers["authorization"] || "").trim();
    if (!TOKEN || auth !== "Bearer " + TOKEN) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "unauthorized" }));
    }
    const kind = req.url.slice(5); // spin | reroll | streak
    const pools = loadPools();
    const history = loadHistory();
    let picks = null, text = "", type = kind;
    if (kind === "spin" || kind === "reroll") {
      const opts = kind === "reroll" && history.length ? { avoid: mapOf(history[history.length - 1].picks) } : {};
      picks = drawRound(pools, opts);
      const seq = history.length + 1;
      text = renderRecipe(pools, picks, seq, kind);
      history.push({ time: new Date().toISOString(), type: kind, picks, text });
      saveHistory(history);
    } else if (kind === "streak") {
      const ret = toolStreak(pools, {}, history);
      text = ret.content[0].text;
      return jsonRes(res, null, { ok: true, picks: null, text, rounds: ret.rounds || null });
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "unknown api" }));
    }
    return jsonRes(res, null, { ok: true, picks, text });
  }
  if (req.method === "POST" && req.url === "/mcp") {
    const auth = (req.headers["authorization"] || "").trim();
    if (!TOKEN || auth !== "Bearer " + TOKEN) {
      res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": "Bearer realm=\"sp-slot\"" });
      return res.end(JSON.stringify({ error: "unauthorized: Bearer token required" }));
    }
    let chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let msg;
      try { msg = JSON.parse(Buffer.concat(chunks).toString("utf-8")); }
      catch { res.writeHead(400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: "invalid json" })); }
      const { id, method, params } = msg;
      try {
        if (method === "initialize") {
          return jsonRes(res, id, {
            jsonrpc: "2.0", id,
            result: {
              protocolVersion: "2025-03-26",
              capabilities: { tools: {} },
              serverInfo: { name: "sp-slot", version: "1.0.0" },
            },
          });
        }
        if (method === "notifications/initialized") { res.writeHead(204); return res.end(); }
        if (method === "tools/list") return jsonRes(res, id, { jsonrpc: "2.0", id, result: { tools: TOOLS } });
        if (method === "tools/call") {
          let result;
          try { result = callTool(params.name, params.arguments || {}); }
          catch (e) {
            return jsonRes(res, id, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "Error: " + e.message }], isError: true } });
          }
          return jsonRes(res, id, { jsonrpc: "2.0", id, result });
        }
        if (id !== undefined) return jsonRes(res, id, { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
        res.writeHead(204);
        res.end();
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e.message || e) }));
      }
    });
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found", path: req.url }));
});

server.listen(PORT, HOST, () => {
  console.log(`[sp-slot] listening on http://${HOST}:${PORT}/mcp`);
  if (!TOKEN) console.error("[sp-slot] WARNING: SP_SLOT_TOKEN not set — all requests rejected");
});

process.on("SIGTERM", () => {
  server.close();
  process.exit(0);
});
