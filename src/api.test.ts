import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API response handling", () => {
  it("reports non-JSON responses as an API routing error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("The page could not be found", { status: 404, headers: { "Content-Type": "text/html" } }),
    ));

    await expect(api("/products")).rejects.toMatchObject({
      name: "Error",
      message: "The API returned a non-JSON response (HTTP 404). Check that the deployed /api route points to the API function.",
      status: 404,
    });
  });

  it("preserves JSON API error messages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json({ error: "Email or password is incorrect." }, { status: 401 }),
    ));

    await expect(api("/auth/login")).rejects.toMatchObject({
      message: "Email or password is incorrect.",
      status: 401,
    } satisfies Partial<ApiError>);
  });
});
