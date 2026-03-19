require("dotenv").config();
const { createApp } = require("./web");

const PORT = parseInt(process.env.PORT, 10) || 3001;

const app = createApp();
app.listen(PORT, () => {
  console.log(`[OK] Web server running at http://localhost:${PORT}`);
  console.log(`     /        -> Dashboard`);
  console.log(`     /tos     -> Terms of Service`);
  console.log(`     /privacy -> Privacy Policy`);
});
