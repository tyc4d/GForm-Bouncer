# GForm Bouncer

Discord Bot：自動根據 Google Form 回覆，為填寫者指派 **Beta Tester** 角色。

## 運作流程

1. Bot 定時（預設每 5 分鐘）向 Google Forms API 拉取表單回覆
2. 從每筆回覆中擷取填寫者輸入的 Discord ID
3. 在 Discord 伺服器中搜尋對應的成員
4. 如果找到且尚未擁有 Beta Tester 角色，就自動加上

## 事前準備

### 1. Discord Bot

1. 前往 [Discord Developer Portal](https://discord.com/developers/applications) 建立 Application
2. 進入 **Bot** 頁面，複製 **Token**
3. 開啟 **Privileged Gateway Intents** → 勾選 **Server Members Intent**
4. 進入 **OAuth2 → URL Generator**，勾選 `bot` scope 與 `Manage Roles` permission
5. 用產生的連結邀請 Bot 加入你的伺服器
6. 確認 Bot 的角色排序在 "Beta Tester" 角色**之上**

### 2. Google Cloud OAuth2

1. 前往 [Google Cloud Console](https://console.cloud.google.com/)
2. 建立專案（或選擇已有的）
3. 啟用 **Google Forms API**
4. 進入 **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorized redirect URIs: `http://localhost:3000/oauth2callback`
5. 記下 **Client ID** 和 **Client Secret**

### 3. 取得 Refresh Token

```bash
# 安裝依賴
npm install

# 填寫 .env（從 .env.example 複製）
cp .env.example .env
# 編輯 .env，填入 DISCORD_TOKEN、GUILD_ID、GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET

# 執行授權腳本
npm run auth
```

瀏覽器會開啟 Google 授權頁面，登入後終端機會印出 `GOOGLE_REFRESH_TOKEN`，貼回 `.env` 即可。

## 使用方式

```bash
npm start
```

## 環境變數說明

| 變數 | 說明 |
|---|---|
| `DISCORD_TOKEN` | Discord Bot Token |
| `GUILD_ID` | Discord 伺服器 ID |
| `ROLE_ID` | 要指派的角色 ID（預設 Beta Tester） |
| `GOOGLE_CLIENT_ID` | Google OAuth2 Client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth2 Client Secret |
| `GOOGLE_REFRESH_TOKEN` | 透過 `npm run auth` 取得 |
| `GOOGLE_FORM_ID` | Google Form 的 ID |
| `FORM_QUESTION_ID` | 表單中 Discord ID 欄位的 question ID |
| `POLL_INTERVAL` | 輪詢間隔（毫秒），預設 300000（5 分鐘） |
