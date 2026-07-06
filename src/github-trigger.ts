// Triggar GitHub Actions-jobbet som hämtar ankomstlistan från BookVisit.
// Körs från vår egen server (alltid igång, punktlig) eftersom GitHubs inbyggda
// schemaläggare både förskjuter och hoppar över körningar.
import { config } from "./config.js";

export async function triggerArrivalFetch(): Promise<boolean> {
  if (!config.github.token) {
    console.warn("[gh-trigger] GITHUB_TOKEN saknas – kan inte trigga hämtningen.");
    return false;
  }
  const url = `https://api.github.com/repos/${config.github.repo}/actions/workflows/${config.github.workflow}/dispatches`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.github.token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "hono-sjobodar",
        "content-type": "application/json",
      },
      body: JSON.stringify({ ref: "main" }),
    });
    if (res.status === 204) {
      console.log("[gh-trigger] Hämtning av ankomstlista triggad.");
      return true;
    }
    console.error(`[gh-trigger] GitHub svarade ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return false;
  } catch (err) {
    console.error("[gh-trigger] Fel:", err instanceof Error ? err.message : err);
    return false;
  }
}
