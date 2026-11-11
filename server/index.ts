import "dotenv/config";
import { app } from "./app.js";
import { seedAdmin } from "./auth.js";
import { initializeSheets } from "./sheets.js";
import { sheetReady } from "./store.js";

const port = Number(process.env.PORT || 3001);

try {
  await sheetReady();
  await initializeSheets();
  await seedAdmin();
} catch (error) {
  console.error("Store setup did not complete. Check the Apps Script settings in .env and your admin credentials.");
  console.error("Details:", error);
}

app.listen(port, () => {
  console.log(`Loom & Aura API listening on http://localhost:${port}`);
});
