require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits } = require("discord.js");
const { google } = require("googleapis");
const { createApp, loadConfig } = require("./web");

const {
  DISCORD_TOKEN,
  GUILD_ID,
  ROLE_ID,
  REPORT_CHANNEL_ID,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  POLL_INTERVAL,
  PORT,
} = process.env;

const INTERVAL_MS = parseInt(POLL_INTERVAL, 10) || 300_000;
const WEB_PORT = parseInt(PORT, 10) || 3001;

// ── UTC+8 Timestamp ────────────────────────────────────────────

function now() {
  return new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
}

// ── State Persistence ──────────────────────────────────────────

const STATE_PATH = path.join(__dirname, "data", "state.json");

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
  } catch {
    return { processedResponses: [], reportedResponses: [] };
  }
}

function saveState() {
  const dir = path.dirname(STATE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    STATE_PATH,
    JSON.stringify({
      processedResponses: [...processedResponses],
      reportedResponses: [...reportedResponses],
    })
  );
}

const saved = loadState();
const processedResponses = new Set(saved.processedResponses);
const reportedResponses = new Set(saved.reportedResponses);
const unresolvedIdentifiers = new Map();

function getEffectiveConfig() {
  const file = loadConfig();
  return {
    formId: file.selectedFormId || null,
    refreshToken: file.googleRefreshToken || null,
    questionId: file.selectedQuestionId || null,
  };
}

// ── Discord Client ─────────────────────────────────────────────

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.once("ready", () => {
  console.log(`[OK] Discord logged in: ${client.user.tag}`);
  const { formId } = getEffectiveConfig();
  console.log(`[OK] Form ID: ${formId || "(not set, configure via web UI)"}`);
  console.log(`[OK] Poll interval: ${INTERVAL_MS / 1000}s`);
  console.log(`[OK] Restored ${processedResponses.size} processed responses from state`);

  pollFormResponses();
  setInterval(pollFormResponses, INTERVAL_MS);
});

client.on("guildMemberAdd", async (member) => {
  if (member.guild.id !== GUILD_ID) return;
  if (!unresolvedIdentifiers.size) return;

  const name = member.user.username.toLowerCase();
  const globalName = member.user.globalName?.toLowerCase();
  const displayName = member.displayName.toLowerCase();

  for (const [identifier, responseId] of unresolvedIdentifiers) {
    const target = identifier.toLowerCase();
    const isMatch =
      target === name ||
      target === globalName ||
      target === displayName ||
      target === member.id;

    if (!isMatch) continue;

    try {
      if (member.roles.cache.has(ROLE_ID)) {
        console.log(`[JOIN] ${now()} ${member.user.tag} already has role`);
      } else {
        await member.roles.add(ROLE_ID);
        console.log(`[JOIN] ${now()} ${member.user.tag} joined and matched -> Beta Tester`);
      }
      unresolvedIdentifiers.delete(identifier);
      processedResponses.add(responseId);
      saveState();
    } catch (err) {
      console.error(`[ERROR] ${now()} Failed to assign role on join for ${member.user.tag}:`, err.message);
    }
    break;
  }
});

// ── Discord Report ─────────────────────────────────────────────

async function reportToChannel(entry, identifier, reason, questionId) {
  if (!REPORT_CHANNEL_ID) return;
  if (reportedResponses.has(entry.responseId)) return;
  reportedResponses.add(entry.responseId);
  saveState();

  try {
    const channel = await client.channels.fetch(REPORT_CHANNEL_ID);
    if (!channel?.isTextBased()) return;

    const fieldValue = extractFieldValue(entry, questionId);
    const timestamp = entry.lastSubmittedTime || entry.createTime || "N/A";

    const message = [
      `**[回報] 無法處理的表單回覆**`,
      `**原因：** ${reason}`,
      `**填寫內容：** \`${fieldValue || "N/A"}\``,
      `**提交時間：** ${timestamp}`,
    ].join("\n");

    await channel.send(message);
  } catch (err) {
    console.error(`[ERROR] ${now()} Failed to send report:`, err.message);
  }
}

function extractFieldValue(entry, questionId) {
  const answer = entry.answers?.[questionId];
  if (!answer) return null;
  return answer.textAnswers?.answers?.[0]?.value?.trim() || null;
}

// ── Core Logic ─────────────────────────────────────────────────

async function pollFormResponses() {
  const { formId, refreshToken, questionId } = getEffectiveConfig();

  if (!formId || !refreshToken) {
    console.log(`[WARN] ${now()} Form or Google auth not configured.`);
    return;
  }

  console.log(`\n[POLL] ${now()} Fetching form responses...`);

  const oauth2 = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: refreshToken });
  const forms = google.forms({ version: "v1", auth: oauth2 });

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const res = await forms.forms.responses.list({ formId });
    const responses = res.data.responses || [];

    if (!responses.length) {
      console.log(`[POLL] ${now()} No new responses`);
      return;
    }

    let assigned = 0;
    let skipped = 0;
    let notFound = 0;

    for (const entry of responses) {
      if (processedResponses.has(entry.responseId)) {
        skipped++;
        continue;
      }

      const candidates = extractDiscordCandidates(entry, questionId);
      if (!candidates.length) {
        console.log(`[SKIP] ${now()} Response ${entry.responseId}: missing identifier`);
        await reportToChannel(entry, null, "表單回覆中缺少 Discord 識別資訊", questionId);
        processedResponses.add(entry.responseId);
        saveState();
        skipped++;
        continue;
      }

      try {
        let member = null;
        let matchedId = null;
        for (const candidate of candidates) {
          member = await resolveGuildMember(guild, candidate);
          if (member) {
            matchedId = candidate;
            break;
          }
        }

        if (!member) {
          const primary = candidates[0];
          console.log(`[NOT FOUND] ${now()} Discord user: ${primary} (tried ${candidates.length} candidate(s), will check on join)`);
          unresolvedIdentifiers.set(primary, entry.responseId);
          await reportToChannel(entry, primary, `在伺服器中找不到 Discord 使用者「${primary}」`, questionId);
          notFound++;
          continue;
        }

        processedResponses.add(entry.responseId);
        saveState();

        if (member.roles.cache.has(ROLE_ID)) {
          console.log(`[SKIP] ${now()} ${member.user.tag} already has role`);
          skipped++;
          continue;
        }

        await member.roles.add(ROLE_ID);
        console.log(`[ASSIGNED] ${now()} ${member.user.tag} (matched "${matchedId}") -> Beta Tester`);
        assigned++;
      } catch (err) {
        if (err.code === 50013) {
          console.error(
            `[ERROR] ${now()} Missing permissions for ${candidates[0]}. Ensure the bot role is above "Beta Tester".`
          );
        } else {
          console.error(`[ERROR] ${now()} Failed to process ${candidates[0]}:`, err.message);
        }
      }
    }

    console.log(`[RESULT] ${now()} Assigned: ${assigned}, Skipped: ${skipped}, Not found: ${notFound}`);
  } catch (err) {
    console.error(`[ERROR] ${now()} Poll failed:`, err.message);
  }
}

// ── Identifier Extraction ──────────────────────────────────────

function extractDiscordCandidates(response, questionId) {
  const answers = response.answers;
  if (!answers) return [];

  const answer = answers[questionId];
  if (!answer) return [];

  const raw = answer.textAnswers?.answers?.[0]?.value?.trim();
  if (!raw) return [];

  const cleaned = raw.replace(/^@/, "");

  if (/^[a-zA-Z0-9_.#]+$/.test(cleaned)) return [cleaned];

  // Contains non-ASCII (e.g. Chinese): extract all English substrings and try each
  const matches = cleaned.match(/[a-zA-Z][a-zA-Z0-9_.]{2,}/g);
  if (!matches) return [];

  // Deduplicate while preserving order, filter common non-username words
  const skipWords = new Set(["email", "id"]);
  const seen = new Set();
  const result = [];
  for (const m of matches) {
    const lower = m.toLowerCase();
    if (seen.has(lower) || skipWords.has(lower)) continue;
    seen.add(lower);
    result.push(lower);
  }
  return result;
}

// ── Member Resolution ──────────────────────────────────────────

async function resolveGuildMember(guild, identifier) {
  if (/^\d{17,20}$/.test(identifier)) {
    try {
      return await guild.members.fetch(identifier);
    } catch {
      return null;
    }
  }

  const username = identifier.replace(/#\d{4}$/, "").toLowerCase();

  const results = await guild.members.search({ query: username, limit: 100 });

  return (
    results.find(
      (m) =>
        m.user.username.toLowerCase() === username ||
        m.user.globalName?.toLowerCase() === username ||
        m.displayName.toLowerCase() === username
    ) || null
  );
}

// ── Web Server ─────────────────────────────────────────────────

const app = createApp();
app.listen(WEB_PORT, () => {
  console.log(`[OK] Web server running at http://localhost:${WEB_PORT}`);
});

// ── Start Discord Bot ──────────────────────────────────────────

client.login(DISCORD_TOKEN);
