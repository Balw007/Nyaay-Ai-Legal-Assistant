const IST = "Asia/Kolkata";

export function parseDay(d?: string | null): Date | null {
  if (!d) return null;
  // Plain dates (YYYY-MM-DD) are calendar days, not instants.
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00`) : new Date(d);
}

export function fmtDate(d?: string | null, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) {
  const x = parseDay(d);
  return x ? x.toLocaleDateString("en-IN", opts) : "—";
}

export function fmtDay(d?: string | null) {
  return fmtDate(d, { weekday: "short", day: "numeric", month: "short" });
}

export function fmtTime(d?: string | null) {
  const x = parseDay(d);
  return x ? x.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: IST }) : "";
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function daysUntil(d?: string | null): number | null {
  const x = parseDay(d);
  if (!x) return null;
  const t = parseDay(todayISO())!;
  return Math.round((x.getTime() - t.getTime()) / 86_400_000);
}

export function relDays(n: number | null) {
  if (n === null) return "";
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

export function rupees(v?: string | number | null) {
  if (v === undefined || v === null || v === "") return "—";
  const n = Number(String(v).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? `₹${n.toLocaleString("en-IN")}` : String(v);
}

export function timeAgo(iso?: string | null) {
  const x = parseDay(iso);
  if (!x) return "";
  const s = Math.round((Date.now() - x.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return fmtDate(iso, { day: "numeric", month: "short" });
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

