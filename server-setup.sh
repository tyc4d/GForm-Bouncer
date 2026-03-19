#!/usr/bin/env bash
# ============================================================
# GForm Bouncer — Ubuntu 24.04 伺服器初始化腳本
# 用法：sudo bash server-setup.sh
# ============================================================
set -euo pipefail

APP_NAME="gform-bouncer"
DEPLOY_DIR="/opt/$APP_NAME"
DEPLOY_USER="labrunner"

# ── 1/6 安裝 Node.js 22 LTS ────────────────────────────────
echo "=== 1/6 安裝 Node.js 22 LTS ==="
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "Node $(node -v) / npm $(npm -v)"

# ── 2/6 安裝 Git ───────────────────────────────────────────
echo "=== 2/6 安裝 Git ==="
apt-get install -y git

# ── 3/6 建立運行時使用者（gform-bouncer） ───────────────────
echo "=== 3/6 建立運行時使用者：$APP_NAME ==="
if ! id "$APP_NAME" &>/dev/null; then
  useradd --system --no-create-home --shell /usr/sbin/nologin "$APP_NAME"
  echo "  已建立系統使用者 $APP_NAME"
else
  echo "  系統使用者 $APP_NAME 已存在，跳過"
fi

# ── 4/6 建立部署使用者（labrunner） ─────────────────────────
echo "=== 4/6 建立部署使用者：$DEPLOY_USER ==="
if ! id "$DEPLOY_USER" &>/dev/null; then
  adduser --disabled-password --gecos "CI/CD deploy user" "$DEPLOY_USER"
  echo "  已建立使用者 $DEPLOY_USER"
else
  echo "  使用者 $DEPLOY_USER 已存在，跳過"
fi

# SSH 金鑰目錄
DEPLOY_SSH="/home/$DEPLOY_USER/.ssh"
mkdir -p "$DEPLOY_SSH"
touch "$DEPLOY_SSH/authorized_keys"
chmod 700 "$DEPLOY_SSH"
chmod 600 "$DEPLOY_SSH/authorized_keys"
chown -R "$DEPLOY_USER":"$DEPLOY_USER" "$DEPLOY_SSH"

# 部署目錄：labrunner 擁有，gform-bouncer 可讀
mkdir -p "$DEPLOY_DIR"
chown "$DEPLOY_USER":"$APP_NAME" "$DEPLOY_DIR"
chmod 775 "$DEPLOY_DIR"

# 限定 sudo 權限：labrunner 只能管理此服務與複製服務檔
SUDOERS_FILE="/etc/sudoers.d/$DEPLOY_USER"
cat > "$SUDOERS_FILE" <<SUDOERS
# labrunner — 僅限 gform-bouncer 服務管理
$DEPLOY_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart $APP_NAME
$DEPLOY_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop $APP_NAME
$DEPLOY_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl status $APP_NAME
$DEPLOY_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl daemon-reload
$DEPLOY_USER ALL=(ALL) NOPASSWD: /usr/bin/cp $DEPLOY_DIR/$APP_NAME.service /etc/systemd/system/$APP_NAME.service
SUDOERS
chmod 440 "$SUDOERS_FILE"
echo "  已設定 sudoers 規則 → $SUDOERS_FILE"

# ── 5/6 安裝 systemd 服務 ──────────────────────────────────
echo "=== 5/6 安裝 systemd 服務 ==="
if [ -f "$DEPLOY_DIR/$APP_NAME.service" ]; then
  cp "$DEPLOY_DIR/$APP_NAME.service" "/etc/systemd/system/$APP_NAME.service"
else
  echo "  ⚠️  服務檔尚未部署，第一次部署後會自動安裝"
fi
systemctl daemon-reload
systemctl enable "$APP_NAME"

# ── 6/6 完成 ───────────────────────────────────────────────
echo "=== 6/6 完成 ==="
cat <<MSG

✅ 伺服器初始化完成！

使用者分級：
  labrunner      → CI/CD 部署用，SSH 登入，限定 sudo
  gform-bouncer  → Bot 運行用，無法登入

接下來請：
  1. 將 GitHub Actions 的 SSH 公鑰加入：
     /home/$DEPLOY_USER/.ssh/authorized_keys

  2. 將 .env 放到 $DEPLOY_DIR/.env
     sudo chown $APP_NAME:$APP_NAME $DEPLOY_DIR/.env
     sudo chmod 640 $DEPLOY_DIR/.env

  3. 推送程式碼到 GitHub main 分支，CI/CD 會自動部署

管理指令：
  sudo systemctl status $APP_NAME    # 查看狀態
  sudo systemctl restart $APP_NAME   # 重啟
  sudo journalctl -u $APP_NAME -f   # 即時日誌

MSG
