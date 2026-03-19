require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { google } = require("googleapis");
const { createApp, loadConfig } = require("./web");

const {
  DISCORD_TOKEN,
  GUILD_ID,
  ROLE_ID,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN,
  GOOGLE_FORM_ID,
  FORM_QUESTION_ID,
  POLL_INTERVAL,
  PORT,
} = process.env;

const INTERVAL_MS = parseInt(POLL_INTERVAL, 10) || 300_000;
const WEB_PORT = parseInt(PORT, 10) || 3001;

const processedResponses = new Set();

// config.json takes priority, .env as fallback
function getEffectiveConfig() {
  const file = loadConfig();
  return {
    formId: file.selectedFormId || GOOGLE_FORM_ID,
    refreshToken: file.googleRefreshToken || GOOGLE_REFRESH_TOKEN,
    questionId: FORM_QUESTION_ID,
  };
}

// ── Discord Client ─────────────────────────────────────────────

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.once("ready", () => {
  console.log(`✅ 已登入 Discord：${client.user.tag}`);
  const { formId } = getEffectiveConfig();
  console.log(`📋 表單 ID：${formId || "(尚未設定，請至網頁介面選擇)"}`);
  console.log(`🔄 輪詢間隔：${INTERVAL_MS / 1000} 秒`);

  pollFormResponses();
  setInterval(pollFormResponses, INTERVAL_MS);
});

// ── Core Logic ─────────────────────────────────────────────────

async function pollFormResponses() {
  const { formId, refreshToken, questionId } = getEffectiveConfig();

  if (!formId || !refreshToken) {
    console.log("⚠️  尚未設定表單或 Google 授權，請至網頁介面完成設定");
    return;
  }

  console.log(`\n⏳ [${new Date().toLocaleTimeString()}] 正在擷取表單回覆…`);

  const oauth2 = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: refreshToken });
  const forms = google.forms({ version: "v1", auth: oauth2 });

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const res = await forms.forms.responses.list({ formId });
    const responses = res.data.responses || [];

    if (!responses.length) {
      console.log("📭 沒有新的回覆");
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

      const discordId = extractDiscordId(entry, questionId);
      if (!discordId) {
        console.log(`⚠️  回覆 ${entry.responseId} 缺少 Discord ID，跳過`);
        skipped++;
        continue;
      }

      try {
        const member = await guild.members.fetch(discordId);

        if (member.roles.cache.has(ROLE_ID)) {
          console.log(`⏩ ${member.user.tag} 已有 Beta Tester 角色`);
          skipped++;
          continue;
        }

        await member.roles.add(ROLE_ID);
        console.log(`✅ 已為 ${member.user.tag} 加上 Beta Tester 角色`);
        assigned++;
      } catch (err) {
        if (err.code === 10007 || err.code === 10013) {
          console.log(`❌ 找不到 Discord 使用者：${discordId}`);
          notFound++;
        } else {
          console.error(`❌ 處理 ${discordId} 時發生錯誤：`, err.message);
        }
      }
    }

    console.log(
      `📊 結果：已指派 ${assigned}，跳過 ${skipped}，找不到 ${notFound}`
    );
  } catch (err) {
    console.error("❌ 輪詢失敗：", err.message);
  }
}

function extractDiscordId(response, questionId) {
  const answers = response.answers;
  if (!answers) return null;

  const answer = answers[questionId];
  if (!answer) return null;

  const text = answer.textAnswers?.answers?.[0]?.value?.trim();
  if (!text) return null;

  const mentionMatch = text.match(/^<@!?(\d+)>$/);
  return mentionMatch
    ? mentionMatch[1]
    : /^\d{17,20}$/.test(text)
      ? text
      : null;
}

// ── Web Server ─────────────────────────────────────────────────

const app = createApp();
app.listen(WEB_PORT, () => {
  console.log(`🌐 網頁伺服器已啟動：http://localhost:${WEB_PORT}`);
});

// ── Start Discord Bot ──────────────────────────────────────────

client.login(DISCORD_TOKEN);
