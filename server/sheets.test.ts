import { afterEach, describe, expect, it, vi } from "vitest";
import { sheetReady } from "./sheets.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Apps Script connection configuration", () => {
  it("explains which settings are missing", () => {
    vi.stubEnv("GOOGLE_APPS_SCRIPT_URL", "");
    vi.stubEnv("GOOGLE_APPS_SCRIPT_SECRET", "");
    expect(() => sheetReady()).toThrow("Set GOOGLE_APPS_SCRIPT_URL and GOOGLE_APPS_SCRIPT_SECRET");
  });

  it("accepts a deployed Apps Script URL and private key", () => {
    vi.stubEnv("GOOGLE_APPS_SCRIPT_URL", "https://script.google.com/macros/s/deployment-id/exec");
    vi.stubEnv("GOOGLE_APPS_SCRIPT_SECRET", "a".repeat(64));
    expect(() => sheetReady()).not.toThrow();
  });

  it("rejects a spreadsheet URL in place of the web app URL", () => {
    vi.stubEnv("GOOGLE_APPS_SCRIPT_URL", "https://docs.google.com/spreadsheets/d/example/edit");
    vi.stubEnv("GOOGLE_APPS_SCRIPT_SECRET", "a".repeat(64));
    expect(() => sheetReady()).toThrow("ending in /exec");
  });
});
