#!/usr/bin/env bash
# ============================================================
# GForm Bouncer — Ubuntu 24.04 伺服器初始化腳本
# 用法：sudo bash server-setup.sh
# ============================================================
set -euo pipefail

APP_NAME="gform-bouncer"
DEPLOY_DIR="/opt/$APP_NAME"

echo "=== 1/5 安裝 Node.js 22 LTS ==="
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "Node $(node -v) / npm $(npm -v)"

echo "=== 2/5 安裝 Git ==="
apt-get install -y git

echo "=== 3/5 建立系統使用者與目錄 ==="
if ! id "$APP_NAME" &>/dev/null; then
  useradd --system --no-create-home --shell /usr/sbin/nologin "$APP_NAME"
fi
mkdir -p "$DEPLOY_DIR"
chown "$APP_NAME":"$APP_NAME" "$DEPLOY_DIR"

echo "=== 4/5 安裝 systemd 服務 ==="
cp "$DEPLOY_DIR/$APP_NAME.service" "/etc/systemd/system/$APP_NAME.service" 2>/dev/null || \
  echo "⚠️  服務檔尚未部署，請在第一次部署後執行：sudo cp $DEPLOY_DIR/$APP_NAME.service /etc/systemd/system/"
systemctl daemon-reload
systemctl enable "$APP_NAME"

echo "=== 5/5 完成 ==="
cat <<MSG

✅ 伺服器初始化完成！

接下來請：
  1. 將 .env 檔案放到 $DEPLOY_DIR/.env
  2. 推送程式碼到 GitHub main 分支，CI/CD 會自動部署
  3. 第一次部署後，執行：
     sudo cp $DEPLOY_DIR/$APP_NAME.service /etc/systemd/system/
     sudo systemctl daemon-reload
     sudo systemctl restart $APP_NAME

管理指令：
  sudo systemctl status $APP_NAME    # 查看狀態
  sudo systemctl restart $APP_NAME   # 重啟
  sudo journalctl -u $APP_NAME -f   # 即時日誌

MSG
