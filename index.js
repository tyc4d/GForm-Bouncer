require("dotenv").config();
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

const processedResponses = new Set();

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

  pollFormResponses();
  setInterval(pollFormResponses, INTERVAL_MS);
});

// ── Discord Report ─────────────────────────────────────────────

const reportedResponses = new Set();

async function reportToChannel(entry, identifier, reason, questionId) {
  if (!REPORT_CHANNEL_ID) return;
  if (reportedResponses.has(entry.responseId)) return;
  reportedResponses.add(entry.responseId);

  try {
    const channel = await client.channels.fetch(REPORT_CHANNEL_ID);
    if (!channel?.isTextBased()) return;

    const fieldValue = extractFieldValue(entry, questionId);
    const timestamp = entry.lastSubmittedTime || entry.createTime || "N/A";

    const message = [
      `**[REPORT] Unresolved form response**`,
      `**Reason:** ${reason}`,
      `**Input value:** \`${fieldValue || "N/A"}\``,
      `**Submitted:** ${timestamp}`,
    ].join("\n");

    await channel.send(message);
  } catch (err) {
    console.error("[ERROR] Failed to send report:", err.message);
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
    console.log("[WARN] Form or Google auth not configured. Please complete setup via web UI.");
    return;
  }

  console.log(`\n[POLL] ${new Date().toLocaleTimeString()} Fetching form responses...`);

  const oauth2 = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: refreshToken });
  const forms = google.forms({ version: "v1", auth: oauth2 });

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const res = await forms.forms.responses.list({ formId });
    const responses = res.data.responses || [];

    if (!responses.length) {
      console.log("[POLL] No new responses");
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
      processedResponses.add(entry.responseId);

      const identifier = extractDiscordIdentifier(entry, questionId);
      if (!identifier) {
        console.log(`[SKIP] Response ${entry.responseId}: missing Discord identifier`);
        await reportToChannel(entry, null, "Missing Discord identifier in form response", questionId);
        skipped++;
        continue;
      }

      try {
        const member = await resolveGuildMember(guild, identifier);
        if (!member) {
          console.log(`[NOT FOUND] Discord user: ${identifier}`);
          await reportToChannel(entry, identifier, "Cannot find Discord user in server", questionId);
          notFound++;
          continue;
        }

        if (member.roles.cache.has(ROLE_ID)) {
          console.log(`[SKIP] ${member.user.tag} already has Beta Tester role`);
          skipped++;
          continue;
        }

        await member.roles.add(ROLE_ID);
        console.log(`[ASSIGNED] ${member.user.tag} -> Beta Tester`);
        assigned++;
      } catch (err) {
        if (err.code === 50013) {
          console.error(
            `[ERROR] Missing permissions for ${identifier}. Ensure the bot role is above "Beta Tester" in server settings.`
          );
        } else {
          console.error(`[ERROR] Failed to process ${identifier}:`, err.message);
        }
      }
    }

    console.log(
      `[RESULT] Assigned: ${assigned}, Skipped: ${skipped}, Not found: ${notFound}`
    );
  } catch (err) {
    console.error("[ERROR] Poll failed:", err.message);
  }
}

function extractDiscordIdentifier(response, questionId) {
  const answers = response.answers;
  if (!answers) return null;

  const answer = answers[questionId];
  if (!answer) return null;

  const raw = answer.textAnswers?.answers?.[0]?.value?.trim();
  if (!raw) return null;

  // Strip leading @ if present
  return raw.replace(/^@/, "");
}

async function resolveGuildMember(guild, identifier) {
  // If numeric ID (17-20 digits), fetch directly
  if (/^\d{17,20}$/.test(identifier)) {
    try {
      return await guild.members.fetch(identifier);
    } catch {
      return null;
    }
  }

  // Strip old-style discriminator (e.g. "User#1234" → "User")
  const username = identifier.replace(/#\d{4}$/, "").toLowerCase();

  // Search guild members by username
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
