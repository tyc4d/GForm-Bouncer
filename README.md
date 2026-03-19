# GForm Bouncer

Discord Bot：自動根據 Google Form 回覆，為填寫者指派 **Beta Tester** 角色。

附帶 Web 管理面板，可透過 Google OAuth 登入並選擇要共享的表單與篩選欄位。

## 運作流程

1. 管理者透過網頁介面登入 Google 帳號，選擇要監聽的 Google Form 及篩選欄位
2. Bot 定時（預設每 5 分鐘）向 Google Forms API 拉取表單回覆
3. 從每筆回覆中擷取填寫者輸入的 Discord ID
4. 在 Discord 伺服器中搜尋對應的成員
5. 如果找到且尚未擁有 Beta Tester 角色，就自動加上

## 專案結構

```
├── index.js              # 主程式（Discord Bot + Web Server）
├── web.js                # Express 模組（OAuth、API、頁面路由）
├── static.js             # 僅啟動 Web Server（不含 Bot）
├── public/
│   └── index.html        # 管理面板前端（OAuth 登入 + 表單選擇）
├── tos.html              # 服務條款
├── privacy.html          # 隱私權政策
├── gform-bouncer.service # systemd 服務檔
├── server-setup.sh       # Ubuntu 伺服器初始化腳本
├── data/                  # 執行時期設定（git ignored）
│   └── config.json
└── .github/
    └── workflows/
        └── deploy.yml    # CI/CD 自動部署
```

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
3. 啟用 **Google Forms API** 和 **Google Drive API**
4. 進入 **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorized redirect URIs:
     - `http://localhost:3001/auth/callback`（本地開發）
     - `https://your-domain/auth/callback`（正式環境）
5. 記下 **Client ID** 和 **Client Secret**

## 快速開始

```bash
npm install
cp .env.example .env
# 編輯 .env，填入 DISCORD_TOKEN、GUILD_ID、GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET
```

### 設定表單（透過網頁介面）

```bash
npm run static
```

開啟 `http://localhost:3001`，用 Google 帳號登入 → 選擇表單 → 選擇篩選欄位 → 儲存。設定會存在 `data/config.json`。

### 啟動完整服務

```bash
npm start
```

同時啟動 Discord Bot 和 Web Server。

## NPM Scripts

| 指令 | 說明 |
|---|---|
| `npm start` | 啟動 Discord Bot + Web Server |
| `npm run static` | 僅啟動 Web Server（管理面板 + TOS + Privacy） |

## 環境變數

| 變數 | 必填 | 說明 |
|---|---|---|
| `DISCORD_TOKEN` | ✅ | Discord Bot Token |
| `GUILD_ID` | ✅ | Discord 伺服器 ID |
| `ROLE_ID` | ✅ | 要指派的角色 ID（預設 Beta Tester） |
| `GOOGLE_CLIENT_ID` | ✅ | Google OAuth2 Client ID |
| `GOOGLE_CLIENT_SECRET` | ✅ | Google OAuth2 Client Secret |
| `OAUTH_REDIRECT_URI` | — | OAuth2 callback URL，預設 `http://localhost:3001/auth/callback` |
| `POLL_INTERVAL` | — | 輪詢間隔（毫秒），預設 300000（5 分鐘） |
| `PORT` | — | Web Server 連接埠，預設 3001 |

> Google Refresh Token、表單 ID、篩選欄位 ID 皆透過網頁介面設定，儲存於 `data/config.json`。

## 部署（Ubuntu 24.04）

### 伺服器初始化

```bash
sudo bash server-setup.sh
```

自動安裝 Node.js 22、Git，建立使用者分級：

- `labrunner` — CI/CD 部署用（限定 sudo 權限）
- `gform-bouncer` — Bot 運行用（無法登入）

### CI/CD

推送到 `main` 分支會觸發 GitHub Actions 自動部署。

需設定的 GitHub Secrets：

| Secret | 說明 |
|---|---|
| `SSH_HOST` | 伺服器 IP 或域名 |
| `SSH_USER` | `labrunner` |
| `SSH_PRIVATE_KEY` | SSH 私鑰 |
| `SSH_PORT` | SSH 連接埠（非 22 才需要） |

### 管理指令

```bash
sudo systemctl status gform-bouncer     # 查看狀態
sudo systemctl restart gform-bouncer    # 重啟
sudo systemctl stop gform-bouncer       # 停止
sudo journalctl -u gform-bouncer -f     # 即時日誌
```

## 法律文件

- [服務條款](/tos)
- [隱私權政策](/privacy)
