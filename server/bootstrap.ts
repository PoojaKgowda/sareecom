import { seedAdmin } from "./auth.js";
import { initializeSheets } from "./sheets.js";
import { sheetReady } from "./store.js";

let initialization: Promise<void> | undefined;

export function initializeStore(): Promise<void> {
  if (!initialization) {
    initialization = (async () => {
      await sheetReady();
      await initializeSheets();
      await seedAdmin();
    })().catch((error: unknown) => {
      initialization = undefined;
      throw error;
    });
  }
  return initialization;
}
