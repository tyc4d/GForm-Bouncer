require("dotenv").config();
const { createApp } = require("./web");

const PORT = parseInt(process.env.PORT, 10) || 3001;

const app = createApp();
app.listen(PORT, () => {
  console.log(`🌐 網頁伺服器已啟動：http://localhost:${PORT}`);
  console.log(`   /        → 管理面板`);
  console.log(`   /tos     → 服務條款`);
  console.log(`   /privacy → 隱私權政策`);
});
