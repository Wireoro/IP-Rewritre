require("dotenv").config();
const express    = require("express");
const cors       = require("cors");
const fetch      = require("node-fetch");
const path       = require("path");
const crypto     = require("crypto");
const fs         = require("fs");

const app = express();
app.use(cors({ credentials: true }));
app.use(express.json({ limit: "10mb" }));

// ── Cookie parser (inline, no extra dep) ─────────────────────────────────────
function parseCookies(req) {
  const raw = req.headers.cookie || "";
  return Object.fromEntries(
    raw.split(";").map(s => s.trim().split("=").map(decodeURIComponent))
  );
}

// ── Session store (in-memory, survives restarts via file) ─────────────────────
const SESSION_FILE = path.join(__dirname, ".sessions.json");
const SESSION_TTL  = 48 * 60 * 60 * 1000; // 48 hours

let sessions = {};
try {
  const saved = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
  const now   = Date.now();
  // only keep non-expired sessions
  for (const [k, v] of Object.entries(saved)) {
    if (v.expires > now) sessions[k] = v;
  }
} catch (_) {}

function saveSessions() {
  try { fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions)); } catch (_) {}
}

function createSession(siteUrl) {
  const id      = crypto.randomBytes(32).toString("hex");
  const expires = Date.now() + SESSION_TTL;
  sessions[id]  = { siteUrl, expires };
  saveSessions();
  return { id, expires };
}

function getSession(req) {
  const cookies = parseCookies(req);
  const id      = cookies["wc_session"];
  if (!id) return null;
  const s = sessions[id];
  if (!s || s.expires < Date.now()) return null;
  return s;
}

function requireSession(req, res) {
  const s = getSession(req);
  if (!s) {
    res.status(401).json({ error: "Not connected. Please connect your site first.", needsConnect: true });
    return null;
  }
  return s;
}

// ── Static files ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  const htmlPath = path.join(__dirname, "public", "index.html");
  const rootPath = path.join(__dirname, "index.html");
  if (fs.existsSync(htmlPath)) return res.sendFile(htmlPath);
  if (fs.existsSync(rootPath)) return res.sendFile(rootPath);
  res.status(404).send("index.html not found.");
});

// ── Helpers ───────────────────────────────────────────────────────────────────

// Always use https://, strip trailing slashes
function normaliseUrl(raw) {
  let url = (raw || "").trim().replace(/\/+$/, "");
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }
  // Force https — WP REST API needs it; http just 301-redirects POSTs
  url = url.replace(/^http:\/\//i, "https://");
  return url;
}

const WORDCRAFT_SECRET = process.env.WORDCRAFT_SECRET || "944575b11e7f3dc73d0796ec04329563a39dbe0c14641743277c45d22cb7a7fa";

function pluginHeaders() {
  return {
    "Content-Type":       "application/json",
    "X-WordCraft-Secret": WORDCRAFT_SECRET,
  };
}

function extractText(content) {
  if (!Array.isArray(content)) return "";
  return content.filter(b => b.type === "text").map(b => b.text).join("") || content[0]?.text || "";
}

function parsePostId(input) {
  try {
    const u  = new URL(input);
    const id = u.searchParams.get("post");
    if (id && /^\d+$/.test(id)) return parseInt(id, 10);
  } catch (_) {}
  if (/^\d+$/.test((input || "").trim())) return parseInt(input.trim(), 10);
  return null;
}

function htmlToGutenberg(html) {
  if (!html) return "";
  const blocks = [];
  let remaining = html.trim();

  while (remaining.length > 0) {
    remaining = remaining.trim();
    if (!remaining) break;
    let m;

    m = remaining.match(/^<h2[^>]*>([\s\S]*?)<\/h2>/i);
    if (m) { blocks.push(`<!-- wp:heading {"level":2} -->\n<h2 class="wp-block-heading">${m[1].trim()}</h2>\n<!-- /wp:heading -->`); remaining = remaining.slice(m[0].length); continue; }

    m = remaining.match(/^<h3[^>]*>([\s\S]*?)<\/h3>/i);
    if (m) { blocks.push(`<!-- wp:heading {"level":3} -->\n<h3 class="wp-block-heading">${m[1].trim()}</h3>\n<!-- /wp:heading -->`); remaining = remaining.slice(m[0].length); continue; }

    m = remaining.match(/^<blockquote[^>]*>([\s\S]*?)<\/blockquote>/i);
    if (m) { blocks.push(`<!-- wp:quote -->\n<blockquote class="wp-block-quote"><p>${m[1].trim()}</p></blockquote>\n<!-- /wp:quote -->`); remaining = remaining.slice(m[0].length); continue; }

    m = remaining.match(/^<ul[^>]*>([\s\S]*?)<\/ul>/i);
    if (m) {
      const items = []; let li; const rx = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      while ((li = rx.exec(m[1])) !== null) items.push(`<li>${li[1].trim()}</li>`);
      blocks.push(`<!-- wp:list -->\n<ul class="wp-block-list">${items.join("\n")}</ul>\n<!-- /wp:list -->`);
      remaining = remaining.slice(m[0].length); continue;
    }

    m = remaining.match(/^<ol[^>]*>([\s\S]*?)<\/ol>/i);
    if (m) {
      const items = []; let li; const rx = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      while ((li = rx.exec(m[1])) !== null) items.push(`<li>${li[1].trim()}</li>`);
      blocks.push(`<!-- wp:list {"ordered":true} -->\n<ol class="wp-block-list">${items.join("\n")}</ol>\n<!-- /wp:list -->`);
      remaining = remaining.slice(m[0].length); continue;
    }

    m = remaining.match(/^<p[^>]*>([\s\S]*?)<\/p>/i);
    if (m) {
      const inner = m[1].trim();
      if (inner) blocks.push(`<!-- wp:paragraph -->\n<p>${inner}</p>\n<!-- /wp:paragraph -->`);
      remaining = remaining.slice(m[0].length); continue;
    }

    m = remaining.match(/^<[^>]+>/);
    if (m) { remaining = remaining.slice(m[0].length); continue; }

    m = remaining.match(/^([^<]+)/);
    if (m) { const t = m[1].trim(); if (t) blocks.push(`<!-- wp:paragraph -->\n<p>${t}</p>\n<!-- /wp:paragraph -->`); remaining = remaining.slice(m[0].length); continue; }

    break;
  }
  return blocks.join("\n\n");
}

function gutenbergToPlainText(content) {
  return content.replace(/<!-- .*?-->/gs, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function gutenbergToHtml(content) {
  return content.replace(/<!-- wp:[^>]*-->/g, "").replace(/<!-- \/wp:[^>]*-->/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

// ── Health ────────────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => res.json({ ok: true }));

// ── Check session ─────────────────────────────────────────────────────────────
// GET /api/session
// Returns current session info so the frontend can skip the connect screen
app.get("/api/session", (req, res) => {
  const s = getSession(req);
  if (!s) return res.json({ connected: false });
  return res.json({ connected: true, siteUrl: s.siteUrl, expires: s.expires });
});

// ── Connect ───────────────────────────────────────────────────────────────────
// POST /api/connect
// Body: { siteUrl }
// Pings the plugin to verify the secret works, then issues a session cookie

app.post("/api/connect", async (req, res) => {
  const { siteUrl } = req.body;
  if (!siteUrl) return res.status(400).json({ error: "siteUrl is required." });

  const base = normaliseUrl(siteUrl);

  // Step 1 — check the WP REST API is reachable at all
  try {
    const probe = await fetch(`${base}/wp-json/`, { method: "GET" });
    if (!probe.ok && probe.status !== 404) {
      return res.status(502).json({ error: `Could not reach the WordPress REST API at ${base}/wp-json/ (HTTP ${probe.status}). Check the site URL.` });
    }
  } catch (err) {
    return res.status(502).json({ error: `Could not reach ${base}. Make sure the URL is correct and the site is live. (${err.message})` });
  }

  // Step 2 — ping the WordCraft plugin
  try {
    const r = await fetch(`${base}/wp-json/wordcraft/v1/ping`, {
      method:  "POST",
      headers: pluginHeaders(),
      body:    JSON.stringify({}),
    });

    if (r.status === 404) {
      return res.status(404).json({ error: "WordCraft plugin not found on that site. Upload wordcraft-rewriter-connector.php to wp-content/plugins/ and activate it in WP Admin → Plugins." });
    }
    if (r.status === 403) {
      return res.status(403).json({ error: "Secret key mismatch. The WORDCRAFT_SECRET value in the plugin file must match the one set in your Render environment variables." });
    }
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      return res.status(r.status).json({ error: `WordPress returned HTTP ${r.status}. ${txt.slice(0, 120)}` });
    }

    const data = await r.json();
    if (!data.ok) return res.status(500).json({ error: "Plugin responded but returned an unexpected result." });

    const { id, expires } = createSession(base);
    res.setHeader("Set-Cookie", [`wc_session=${id}; HttpOnly; Path=/; Max-Age=${48 * 60 * 60}; SameSite=Lax`]);
    return res.json({ ok: true, siteName: data.siteName || base, siteUrl: base, expires });

  } catch (err) {
    return res.status(500).json({ error: `Plugin ping failed: ${err.message}` });
  }
});

// ── Disconnect ────────────────────────────────────────────────────────────────
app.post("/api/disconnect", (req, res) => {
  const cookies = parseCookies(req);
  const id = cookies["wc_session"];
  if (id) { delete sessions[id]; saveSessions(); }
  res.setHeader("Set-Cookie", "wc_session=; HttpOnly; Path=/; Max-Age=0");
  res.json({ ok: true });
});

// ── Fetch article ─────────────────────────────────────────────────────────────
// POST /api/fetch-article
// Body: { wpAdminUrl }   — siteUrl comes from session

app.post("/api/fetch-article", async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;

  const { wpAdminUrl } = req.body;
  if (!wpAdminUrl) return res.status(400).json({ error: "wpAdminUrl is required." });

  const postId = parsePostId(wpAdminUrl);
  if (!postId) return res.status(400).json({ error: "Could not find a post ID in that URL. Use the WP admin URL: /wp-admin/post.php?post=123&action=edit" });

  try {
    const r = await fetch(`${session.siteUrl}/wp-json/wordcraft/v1/get-post`, {
      method:  "POST",
      headers: pluginHeaders(),
      body:    JSON.stringify({ post_id: postId }),
    });

    if (r.status === 403) return res.status(403).json({ error: "Plugin secret mismatch.", needsConnect: true });
    if (r.status === 404) return res.status(404).json({ error: `Post #${postId} not found.` });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.message || `Plugin error ${r.status}` });

    const rawContent  = data.content || "";
    const displayHtml = gutenbergToHtml(rawContent);
    const plainText   = gutenbergToPlainText(rawContent);

    return res.json({ postId: data.postId, title: data.title, displayHtml, plainText, rawContent, slug: data.slug || "", status: data.status || "draft", link: data.link || "", editUrl: data.editUrl || "" });

  } catch (err) {
    return res.status(500).json({ error: `Network error: ${err.message}` });
  }
});

// ── Rewrite ───────────────────────────────────────────────────────────────────
// POST /api/rewrite
// Body: { title, plainText, instructions }

app.post("/api/rewrite", async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;

  const { title, plainText, instructions } = req.body;

  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set on server." });
  if (!plainText || !instructions)      return res.status(400).json({ error: "plainText and instructions are required." });

  const systemPrompt = `You are an expert SEO content writer for IntellectualPrestige.com, a premium website.
Rewrite articles based on the editor's exact instructions, maintaining factual accuracy.

OUTPUT FORMAT:
- Return ONLY the rewritten HTML body — no preamble, no markdown fences, no explanation
- Do NOT include <h1> — WordPress handles the title separately
- Do NOT include a Table of Contents — a plugin handles that
- Use only: h2, h3, p, strong, em, ul, ol, li, blockquote
- H2: 3–5 major sections. H3: subsections inside H2. Never H4+
- First element must be an H2`;

  const userMessage = `TITLE: ${title}\n\nORIGINAL:\n${plainText}\n\nINSTRUCTIONS:\n${instructions}\n\nRewrite now. Return only HTML.`;

  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 120000);

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      signal: controller.signal,
      body: JSON.stringify({ model: "claude-opus-4-8", max_tokens: 10000, system: systemPrompt, messages: [{ role: "user", content: userMessage }] }),
    });

    clearTimeout(timeout);
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || "Claude API error" });

    const content = extractText(data.content);
    if (!content) return res.status(500).json({ error: "Claude returned empty content." });
    return res.json({ content });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Update article ────────────────────────────────────────────────────────────
// POST /api/update-article
// Body: { postId, title, newContent }

app.post("/api/update-article", async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;

  const { postId, title, newContent } = req.body;
  if (!postId) return res.status(400).json({ error: "postId is required." });

  const gutenbergContent = htmlToGutenberg(newContent || "");

  try {
    const r = await fetch(`${session.siteUrl}/wp-json/wordcraft/v1/update-post`, {
      method:  "POST",
      headers: pluginHeaders(),
      body:    JSON.stringify({ post_id: postId, title: title || "", content: gutenbergContent }),
    });

    if (r.status === 403) return res.status(403).json({ error: "Plugin secret mismatch.", needsConnect: true });
    if (r.status === 404) return res.status(404).json({ error: `Post #${postId} not found.` });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.message || `Plugin error ${r.status}` });

    return res.json({ ok: true, postId: data.postId, editUrl: data.editUrl, link: data.link || "" });

  } catch (err) {
    return res.status(500).json({ error: `Network error: ${err.message}` });
  }
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`WordCraft Rewriter on http://localhost:${PORT}`));
server.keepAliveTimeout = 120000;
server.headersTimeout   = 125000;
