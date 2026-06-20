import { config } from "./config.js";

// Returnerar dagens datum (YYYY-MM-DD) i appens tidszon.
export function todayInTz(tz: string = config.timezone): string {
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // sv-SE ger redan YYYY-MM-DD.
  return fmt.format(new Date());
}

export function isValidDate(d: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(d);
}

export function humanDate(d: string): string {
  if (!isValidDate(d)) return d;
  const date = new Date(d + "T12:00:00");
  return new Intl.DateTimeFormat("sv-SE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}
