require("dotenv").config();
const path = require("path");
const express = require("express");

const PORT = parseInt(process.env.PORT, 10) || 3001;
const app = express();

app.get("/", (_req, res) => res.redirect("/tos"));
app.get("/tos", (_req, res) => res.sendFile(path.join(__dirname, "tos.html")));
app.get("/privacy", (_req, res) => res.sendFile(path.join(__dirname, "privacy.html")));

app.listen(PORT, () => {
  console.log(`🌐 靜態網頁伺服器已啟動：http://localhost:${PORT}`);
  console.log(`   /tos     → 服務條款`);
  console.log(`   /privacy → 隱私權政策`);
});
