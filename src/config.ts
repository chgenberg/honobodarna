import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Minimal .env-laddare (ingen extra dependency). Läser KEY=VALUE-rader.
function loadDotEnv(): void {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // Ingen .env i produktion – då sätts variablerna i plattformen (Railway).
  }
}

loadDotEnv();

function bool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function str(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

function num(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: num("PORT", 3000),
  timezone: str("TZ", "Europe/Stockholm"),

  admin: {
    username: str("ADMIN_USERNAME", "anna"),
    password: str("ADMIN_PASSWORD", "byt-mig-direkt"),
  },
  sessionSecret: str("SESSION_SECRET", "osäkert-byt-mig"),

  databasePath: str("DATABASE_PATH", "./data/app.sqlite"),

  bookvisit: {
    baseUrl: str("BOOKVISIT_BASE_URL", "https://restapi.bookvisit.com"),
    apiKey: str("BOOKVISIT_API_KEY"),
    channelId: str("BOOKVISIT_CHANNEL_ID"),
  },

  elks: {
    username: str("ELKS_API_USERNAME"),
    password: str("ELKS_API_PASSWORD"),
    sender: str("SMS_SENDER", "Honosjobod"),
  },

  smtp: {
    host: str("SMTP_HOST"),
    port: num("SMTP_PORT", 587),
    user: str("SMTP_USER"),
    pass: str("SMTP_PASS"),
    from: str("EMAIL_FROM", "Hönö Sjöbodar <anna@pegonia.se>"),
  },

  dryRun: bool("DRY_RUN", true),
  canaryPhone: str("CANARY_PHONE"),
  canaryEmail: str("CANARY_EMAIL"),

  cronSchedule: str("CRON_SCHEDULE", "0 7 * * *"),
  autoSend: bool("AUTO_SEND", false),
};

export type AppConfig = typeof config;
