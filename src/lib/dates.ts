// Toutes les dates sont manipulées dans le fuseau du navigateur,
// puis envoyées au serveur en ISO (UTC).

const pad = (n: number) => String(n).padStart(2, "0");

/** Valeur pour <input type="datetime-local"> (heure locale). */
export function toLocalInput(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "2026-11-10T14:30" (heure locale) -> ISO UTC. */
export function localInputToIso(value: string): string {
  return new Date(value).toISOString();
}

/** Clé de jour local "YYYY-MM-DD". */
export function dayKey(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

/** Lundi qui commence la grille du mois. */
export function gridStart(month: Date): Date {
  const first = startOfMonth(month);
  const offset = (first.getDay() + 6) % 7; // lundi = 0
  return new Date(first.getFullYear(), first.getMonth(), 1 - offset);
}

/** 6 semaines affichées = 42 jours. */
export function gridDays(month: Date): Date[] {
  const start = gridStart(month);
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h) return `${h}h${pad(m)}`;
  if (m) return `${m} min${s && m < 10 ? ` ${pad(s)}s` : ""}`;
  return `${s}s`;
}

export function formatClock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function timeAgo(iso: string, now: number): string {
  const min = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  if (h < 24) return `il y a ${h}h${rest ? pad(rest) : ""}`;
  const days = Math.floor(h / 24);
  return `il y a ${days} j`;
}
