// Recently opened judgments and matters, kept in this browser only (localStorage), for the palette
// and the command centre. Nothing here is sent to the server.
export type Recent = { kind: "judgment" | "matter"; id: string; title: string; sub?: string; at: number };
const KEY = "nyaay-recent";

export function readRecent(): Recent[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Recent[]; } catch { return []; }
}

export function pushRecent(r: Omit<Recent, "at">) {
  try {
    const list = readRecent().filter((x) => !(x.kind === r.kind && x.id === r.id));
    list.unshift({ ...r, at: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 12)));
    window.dispatchEvent(new Event("nyaay-recent"));
  } catch {}
}
