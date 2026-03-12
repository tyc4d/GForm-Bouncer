/**
 * 一次性腳本：取得 Google OAuth2 Refresh Token
 *
 * 使用方式：
 *   1. 在 .env 填入 GOOGLE_CLIENT_ID 和 GOOGLE_CLIENT_SECRET
 *   2. 執行 npm run auth
 *   3. 瀏覽器會自動開啟授權頁面，登入你的 Google 帳號
 *   4. 授權後會取得 refresh_token，貼回 .env 即可
 */

require("dotenv").config();
const http = require("http");
const { google } = require("googleapis");
const { exec } = require("child_process");

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error("❌ 請先在 .env 設定 GOOGLE_CLIENT_ID 和 GOOGLE_CLIENT_SECRET");
  process.exit(1);
}

const REDIRECT_URI = "http://localhost:3000/oauth2callback";
const SCOPES = ["https://www.googleapis.com/auth/forms.responses.readonly"];

const oauth2 = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);

const authUrl = oauth2.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: SCOPES,
});

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith("/oauth2callback")) return;

  const url = new URL(req.url, "http://localhost:3000");
  const code = url.searchParams.get("code");

  if (!code) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h1>❌ 缺少授權碼</h1>");
    return;
  }

  try {
    const { tokens } = await oauth2.getToken(code);

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      "<h1>✅ 授權成功！</h1><p>請回到終端機查看 refresh token，然後關閉此頁面。</p>"
    );

    console.log("\n✅ 授權成功！\n");
    console.log("=".repeat(60));
    console.log("GOOGLE_REFRESH_TOKEN=" + tokens.refresh_token);
    console.log("=".repeat(60));
    console.log("\n👆 請將上面的 refresh token 貼到你的 .env 檔案中\n");

    server.close();
    process.exit(0);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h1>❌ 換取 token 失敗</h1><p>" + err.message + "</p>");
    console.error("❌ 換取 token 失敗：", err.message);
  }
});

server.listen(3000, () => {
  console.log("🌐 本地伺服器已啟動在 http://localhost:3000");
  console.log("📎 正在開啟瀏覽器進行 Google 授權…\n");

  const openCmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";

  exec(`${openCmd} "${authUrl}"`);
});
