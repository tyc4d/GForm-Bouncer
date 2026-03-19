require("dotenv").config();
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const express = require("express");
const { google } = require("googleapis");

const DATA_DIR = path.join(__dirname, "data");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");

// ── Config persistence ─────────────────────────────────────────

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveConfig(patch) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const config = { ...loadConfig(), ...patch };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  return config;
}

// ── In-memory sessions ─────────────────────────────────────────

const sessions = new Map();

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(";").forEach((c) => {
    const [k, ...v] = c.trim().split("=");
    if (k) out[k] = v.join("=");
  });
  return out;
}

// ── Express App ────────────────────────────────────────────────

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.cookies = parseCookies(req.headers.cookie);
    next();
  });

  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
  const REDIRECT_URI =
    process.env.OAUTH_REDIRECT_URI || "http://localhost:3001/auth/callback";

  function makeOAuth2() {
    return new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      REDIRECT_URI
    );
  }

  function getSession(req) {
    return sessions.get(req.cookies?.sid) || null;
  }

  // ── Pages ──────────────────────────────────────────────────

  app.get("/", (_req, res) =>
    res.sendFile(path.join(__dirname, "public", "index.html"))
  );
  app.get("/tos", (_req, res) =>
    res.sendFile(path.join(__dirname, "tos.html"))
  );
  app.get("/privacy", (_req, res) =>
    res.sendFile(path.join(__dirname, "privacy.html"))
  );

  // ── Auth: Google OAuth2 ────────────────────────────────────

  app.get("/auth/google", (_req, res) => {
    const url = makeOAuth2().generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/drive.metadata.readonly",
        "https://www.googleapis.com/auth/forms.responses.readonly",
      ],
    });
    res.redirect(url);
  });

  app.get("/auth/callback", async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send("Missing authorization code");

    try {
      const client = makeOAuth2();
      const { tokens } = await client.getToken(code);
      client.setCredentials(tokens);

      const oauth2Api = google.oauth2({ version: "v2", auth: client });
      const { data: user } = await oauth2Api.userinfo.get();

      if (tokens.refresh_token) {
        saveConfig({ googleRefreshToken: tokens.refresh_token });
      }

      const sid = crypto.randomUUID();
      sessions.set(sid, {
        accessToken: tokens.access_token,
        refreshToken:
          tokens.refresh_token || loadConfig().googleRefreshToken,
        email: user.email,
        name: user.name,
        picture: user.picture,
      });
      res.cookie("sid", sid, { httpOnly: true, maxAge: 7_200_000 });
      res.redirect("/");
    } catch (err) {
      console.error("OAuth callback error:", err.message);
      res.status(500).send("驗證失敗：" + err.message);
    }
  });

  app.post("/auth/logout", (req, res) => {
    const sid = req.cookies?.sid;
    if (sid) sessions.delete(sid);
    res.clearCookie("sid");
    res.json({ ok: true });
  });

  // ── API ────────────────────────────────────────────────────

  app.get("/api/me", (req, res) => {
    const s = getSession(req);
    if (!s) return res.status(401).json({ error: "Unauthorized" });
    res.json({ email: s.email, name: s.name, picture: s.picture });
  });

  app.get("/api/forms", async (req, res) => {
    const s = getSession(req);
    if (!s) return res.status(401).json({ error: "Unauthorized" });

    try {
      const client = makeOAuth2();
      client.setCredentials({
        access_token: s.accessToken,
        refresh_token: s.refreshToken,
      });

      const drive = google.drive({ version: "v3", auth: client });
      const { data } = await drive.files.list({
        q: "mimeType='application/vnd.google-apps.form' and trashed=false",
        fields: "files(id,name,createdTime,modifiedTime)",
        orderBy: "modifiedTime desc",
        pageSize: 50,
      });

      res.json({ forms: data.files || [] });
    } catch (err) {
      console.error("List forms error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/forms/select", (req, res) => {
    const s = getSession(req);
    if (!s) return res.status(401).json({ error: "Unauthorized" });

    const { formId, formName } = req.body;
    if (!formId) return res.status(400).json({ error: "Missing formId" });

    const config = saveConfig({
      selectedFormId: formId,
      selectedFormName: formName || "",
      selectedBy: s.email,
      selectedAt: new Date().toISOString(),
    });
    res.json({ ok: true, config });
  });

  app.get("/api/config", (req, res) => {
    const s = getSession(req);
    if (!s) return res.status(401).json({ error: "Unauthorized" });

    const c = loadConfig();
    res.json({
      selectedFormId: c.selectedFormId || null,
      selectedFormName: c.selectedFormName || null,
      selectedBy: c.selectedBy || null,
      selectedAt: c.selectedAt || null,
    });
  });

  return app;
}

module.exports = { createApp, loadConfig, saveConfig };
