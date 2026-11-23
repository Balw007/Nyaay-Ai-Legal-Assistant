"use client";
import { useEffect } from "react";

/*
 * Motion that answers the cursor and the finger, used where it helps and nowhere else.
 *
 *   Surface                          Effect                                         Why
 *   Welcome band, summary panels     [data-ripple] drum skin                        places you pause on, never places you work
 *   Small choice and status cards    [data-tilt] lean + floating layers (.depth-N)  objects you are about to pick
 *   Buttons and cards you press      [data-press] rubber squash, boing on release   an answer to your own action
 *   Something new arrived            boing(el)                                       draws the eye only when there is news
 *   Something was refused            shake(el)                                       the familiar "no"
 *
 * Lists, tables, the judgment reader, drafts and forms are never animated: motion beside text you read is noise.
 * The ripple needs the cursor to rest on a panel for a moment (passing through on the way elsewhere does nothing)
 * and grows gentler each time the same panel is hovered in a session. One pointer listener, one animation loop,
 * no React re-renders; the loop sleeps when nothing moves. Hover effects need a mouse; presses work everywhere.
 * Everything is off for people who ask for reduced motion.
 */

type Spring = { x: number; v: number };
type Params = { k: number; c: number };
const STEP = 1 / 240;
const sp = (response: number, damping: number): Params => { const w = (2 * Math.PI) / response; return { k: w * w, c: 2 * damping * w }; };
const FOLLOW = sp(0.26, 0.6), RELEASE = sp(0.45, 0.32);       // tilt: track the cursor, then wobble home
const SQUASH = sp(0.12, 0.75), REBOUND = sp(0.36, 0.26);      // press: give quickly, spring back with a boing
const stepS = (s: Spring, target: number, p: Params, dt: number) => { s.v += (-p.k * (s.x - target) - p.c * s.v) * dt; s.x += s.v * dt; };
const near = (s: Spring, t: number, eps: number) => Math.abs(s.x - t) < eps && Math.abs(s.v) < eps * 8;
const S = (x = 0): Spring => ({ x, v: 0 });

/* ------------------------------------------------------------------ public: one-off reactions */
export function boing(el: Element | null | undefined, strength = 1) {
  if (el) window.dispatchEvent(new CustomEvent("nyaay:react", { detail: { el, kind: "boing", strength } }));
}
export function shake(el: Element | null | undefined, strength = 1) {
  if (el) window.dispatchEvent(new CustomEvent("nyaay:react", { detail: { el, kind: "shake", strength } }));
}

/* ------------------------------------------------------------------ drum skin */
type Tile = { n: HTMLDivElement; sh: HTMLDivElement; cx: number; cy: number; z: number; v: number; t: number; a: number; light: boolean | null };
type Skin = { el: HTMLElement; layer: HTMLDivElement; tiles: Tile[]; C: number; R: number; w: number; h: number; tw: number; th: number; hover: boolean; mx: number; my: number; gain: number };
const P = 900, SIGMA = 72, K = 160, DAMP = 5, COUPLE = 900;
const GLASS = "linear-gradient(180deg, var(--g3-sheen), transparent 42%), var(--g3-fill)";
const seen = new Map<string, number>();   // ripple name -> times activated this session

function gainFor(el: HTMLElement) {
  const name = el.dataset.ripple || "panel";
  const n = (seen.get(name) ?? 0) + 1;
  seen.set(name, n);
  const base = name === "hero" ? 1.35 : 0.85;
  return base * Math.max(0.5, 1 - Math.max(0, n - 3) * 0.07);   // novelty fades to half after about ten visits
}

function buildSkin(el: HTMLElement): Skin | null {
  const w = el.offsetWidth, h = el.offsetHeight;
  if (w < 80 || h < 60) return null;
  const glass = el.classList.contains("glass-3") || el.classList.contains("glass");
  const cs = getComputedStyle(el);
  const fill = glass ? GLASS : [cs.backgroundImage !== "none" ? cs.backgroundImage : "", cs.backgroundColor].filter(Boolean).join(", ");
  const C = Math.max(5, Math.min(16, Math.round(w / 64))), R = Math.max(3, Math.min(12, Math.round(h / 64)));
  const tw = w / C, th = h / R, radius = cs.borderTopLeftRadius || "12px";
  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.dataset.skinLayer = "";
  layer.style.cssText = "position:absolute;inset:0;z-index:-1;pointer-events:none;border-radius:inherit;overflow:hidden";
  const tiles: Tile[] = [];
  for (let r = 0; r < R; r++) for (let q = 0; q < C; q++) {
    const n = document.createElement("div");
    const left = q * tw, top = r * th;
    n.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${tw + 0.75}px;height:${th + 0.75}px;` +
      `background:${fill};background-size:${w}px ${h}px;background-position:${-left}px ${-top}px;will-change:transform;overflow:hidden`;
    if (r === 0 && q === 0) n.style.borderTopLeftRadius = radius;
    if (r === 0 && q === C - 1) n.style.borderTopRightRadius = radius;
    if (r === R - 1 && q === 0) n.style.borderBottomLeftRadius = radius;
    if (r === R - 1 && q === C - 1) n.style.borderBottomRightRadius = radius;
    const sh = document.createElement("div");
    sh.style.cssText = "position:absolute;inset:0;opacity:0;will-change:opacity";
    n.appendChild(sh);
    layer.appendChild(n);
    tiles.push({ n, sh, cx: left + tw / 2, cy: top + th / 2, z: 0, v: 0, t: 0, a: 0, light: null });
  }
  el.prepend(layer);
  el.dataset.skin = "";
  return { el, layer, tiles, C, R, w, h, tw, th, hover: false, mx: w / 2, my: h / 2, gain: gainFor(el) };
}
function dropSkin(s: Skin) { s.layer.remove(); delete s.el.dataset.skin; }
function strike(s: Skin, x: number, y: number, force: number) {
  for (const t of s.tiles) t.v += force * s.gain * Math.exp(-((t.cx - x) ** 2 + (t.cy - y) ** 2) / (2 * (SIGMA * 0.7) ** 2));
}
function stepSkin(s: Skin, dt: number) {
  const { tiles, C, R } = s;
  const H = 20 * s.gain;
  for (const t of tiles) t.t = s.hover ? H * Math.exp(-((t.cx - s.mx) ** 2 + (t.cy - s.my) ** 2) / (2 * SIGMA * SIGMA)) : 0;
  let left = dt;
  while (left > 0) {
    const h = Math.min(STEP, left);
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i], r = (i / C) | 0, q = i % C;
      let sum = 0, cnt = 0;
      if (q > 0) { sum += tiles[i - 1].z; cnt++; }
      if (q < C - 1) { sum += tiles[i + 1].z; cnt++; }
      if (r > 0) { sum += tiles[i - C].z; cnt++; }
      if (r < R - 1) { sum += tiles[i + C].z; cnt++; }
      t.a = -K * (t.z - t.t) - DAMP * t.v + COUPLE * (sum / cnt - t.z);
    }
    for (const t of tiles) { t.v += t.a * h; t.z += t.v * h; }
    left -= h;
  }
  let moving = s.hover;
  const ox = s.w / 2, oy = s.h / 2;
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i], r = (i / C) | 0, q = i % C;
    if (Math.abs(t.z) > 0.12 || Math.abs(t.v) > 1.5) moving = true;
    const f = P / (P - t.z);
    t.n.style.transform = `translate3d(${((t.cx - ox) * (f - 1)).toFixed(2)}px,${((t.cy - oy) * (f - 1)).toFixed(2)}px,0) scale(${f.toFixed(4)})`;
    const zl = q > 0 ? tiles[i - 1].z : t.z, zr = q < C - 1 ? tiles[i + 1].z : t.z;
    const zu = r > 0 ? tiles[i - C].z : t.z, zd = r < R - 1 ? tiles[i + C].z : t.z;
    const slope = ((zl - zr) / (2 * s.tw) + (zu - zd) / (2 * s.th)) * 3.2;
    const light = slope >= 0;
    if (light !== t.light) { t.sh.style.background = light ? "rgb(255 255 255)" : "rgb(0 0 0)"; t.light = light; }
    t.sh.style.opacity = Math.min(Math.abs(slope) * (light ? 0.5 : 0.55), light ? 0.14 : 0.16).toFixed(3);
  }
  return moving;
}

/* ------------------------------------------------------------------ tilt and press */
type Tilt = { rx: Spring; ry: Spring; s: Spring; y: Spring; tx: number; ty: number; ts: number; tyy: number; hover: boolean; max: number };
type Press = { sx: Spring; sy: Spring; tx: Spring; down: boolean; give: number };

function editing(el: HTMLElement) {
  const a = document.activeElement as HTMLElement | null;
  return !!a && el.contains(a) && (a.isContentEditable || a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && !["checkbox", "radio", "button", "submit"].includes((a as HTMLInputElement).type)));
}

export function Specular() {
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mouse = window.matchMedia("(pointer: fine)").matches;
    const tilts = new Map<HTMLElement, Tilt>();
    const presses = new Map<HTMLElement, Press>();
    const skins = new Map<HTMLElement, Skin>();
    let raf = 0, last = 0, moveFrame = 0, dwell = 0;
    let ev: PointerEvent | null = null;
    let lastLit: HTMLElement | null = null, card: HTMLElement | null = null, panel: HTMLElement | null = null, pending: HTMLElement | null = null;
    let px = 0, py = 0, pvx = 0, pvy = 0, pt = 0;
    const speed = () => Math.min(Math.hypot(pvx, pvy), 4000);

    const tiltOf = (el: HTMLElement): Tilt => {
      let s = tilts.get(el);
      if (!s) { s = { rx: S(), ry: S(), s: S(1), y: S(), tx: 0, ty: 0, ts: 1, tyy: 0, hover: false, max: Number(el.dataset.tilt) || 4 }; tilts.set(el, s); el.dataset.live = ""; }
      return s;
    };
    const pressOf = (el: HTMLElement): Press => {
      let s = presses.get(el);
      if (!s) {
        const h = el.offsetHeight || 36;
        s = { sx: S(1), sy: S(1), tx: S(), down: false, give: Math.max(0.35, Math.min(1, 44 / h)) };
        presses.set(el, s); el.dataset.pl = "";
      }
      return s;
    };

    const tick = (now: number) => {
      raf = 0;
      const dt = Math.min((now - last) / 1000, 1 / 20);
      last = now;
      for (const [el, s] of tilts) {
        let t = dt; const p = s.hover ? FOLLOW : RELEASE;
        while (t > 0) { const h = Math.min(STEP, t); stepS(s.rx, s.tx, p, h); stepS(s.ry, s.ty, p, h); stepS(s.s, s.ts, p, h); stepS(s.y, s.tyy, p, h); t -= h; }
        if (!s.hover && near(s.rx, 0, 0.01) && near(s.ry, 0, 0.01) && near(s.s, 1, 0.0002) && near(s.y, 0, 0.02)) {
          tilts.delete(el); delete el.dataset.live;
          for (const v of ["--rx", "--ry", "--sc", "--lift", "--px", "--py"]) el.style.removeProperty(v);
          continue;
        }
        el.style.setProperty("--rx", `${s.rx.x.toFixed(3)}deg`);
        el.style.setProperty("--ry", `${s.ry.x.toFixed(3)}deg`);
        el.style.setProperty("--sc", s.s.x.toFixed(5));
        el.style.setProperty("--lift", `${s.y.x.toFixed(2)}px`);
        el.style.setProperty("--px", (s.ry.x / s.max).toFixed(4));   // -1..1, drives the floating layers
        el.style.setProperty("--py", (-s.rx.x / s.max).toFixed(4));
      }
      for (const [el, s] of presses) {
        let t = dt;
        const g = s.give;
        const p = s.down ? SQUASH : REBOUND;
        while (t > 0) { const h = Math.min(STEP, t); stepS(s.sx, s.down ? 1 + 0.035 * g : 1, p, h); stepS(s.sy, s.down ? 1 - 0.075 * g : 1, p, h); stepS(s.tx, 0, REBOUND, h); t -= h; }
        if (!s.down && near(s.sx, 1, 0.0004) && near(s.sy, 1, 0.0004) && near(s.tx, 0, 0.05)) {
          presses.delete(el); delete el.dataset.pl;
          for (const v of ["--psx", "--psy", "--ptx"]) el.style.removeProperty(v);
          continue;
        }
        el.style.setProperty("--psx", s.sx.x.toFixed(5));
        el.style.setProperty("--psy", s.sy.x.toFixed(5));
        el.style.setProperty("--ptx", `${s.tx.x.toFixed(2)}px`);
      }
      for (const [el, s] of skins) {
        if (!el.isConnected) { skins.delete(el); continue; }
        if (!stepSkin(s, dt)) { dropSkin(s); skins.delete(el); }
      }
      if (tilts.size || presses.size || skins.size) raf = requestAnimationFrame(tick);
    };
    const run = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); } };

    const startRipple = (el: HTMLElement) => {
      if (!ev || panel !== el || editing(el)) return;
      let s = skins.get(el);
      if (!s) { const b = buildSkin(el); if (!b) return; s = b; skins.set(el, s); }
      else s.gain = gainFor(el);
      const r = el.getBoundingClientRect();
      const x = (ev.clientX - r.left) * (s.w / r.width), y = (ev.clientY - r.top) * (s.h / r.height);
      s.hover = true; s.mx = x; s.my = y;
      strike(s, x, y, 150 + speed() * 0.1);
      run();
    };

    const onFrame = () => {
      moveFrame = 0;
      if (!ev) return;
      const target = ev.target as Element | null;

      const lit = target?.closest?.("[data-specular]") as HTMLElement | null;
      if (lastLit && lastLit !== lit) lastLit.style.setProperty("--spec-o", "0");
      if (lit) {
        const r = lit.getBoundingClientRect();
        lit.style.setProperty("--mx", `${ev.clientX - r.left}px`);
        lit.style.setProperty("--my", `${ev.clientY - r.top}px`);
        lit.style.setProperty("--spec-o", "1");
      }
      lastLit = lit;
      if (reduce.matches) return;

      // Lean: the card under the cursor tilts towards it; its .depth-N layers float at different depths.
      const nextCard = target?.closest?.("[data-tilt]") as HTMLElement | null;
      if (card && card !== nextCard) { const s = tiltOf(card); s.hover = false; s.tx = 0; s.ty = 0; s.ts = 1; s.tyy = 0; s.ry.v += pvx * s.max * 0.0012; s.rx.v -= pvy * s.max * 0.0012; }
      if (nextCard) {
        const s = tiltOf(nextCard);
        const r = nextCard.getBoundingClientRect();
        if (!s.hover) { s.hover = true; s.ry.v += pvx * s.max * 0.0012; s.rx.v -= pvy * s.max * 0.0012; }
        const fx = (ev.clientX - r.left) / r.width - 0.5, fy = (ev.clientY - r.top) / r.height - 0.5;
        s.tx = -fy * 2 * s.max; s.ty = fx * 2 * s.max;
        s.ts = 1 + Math.min(0.03, 8 / Math.max(r.width, r.height)); s.tyy = -3;
      }
      card = nextCard;

      // Ripple: only after the cursor rests on the panel for a moment.
      const nextPanel = target?.closest?.("[data-ripple]") as HTMLElement | null;
      if (panel !== nextPanel) {
        if (panel) {
          const s = skins.get(panel);
          if (s && s.hover) {
            const r = panel.getBoundingClientRect();
            s.hover = false;
            strike(s, Math.min(Math.max(ev.clientX - r.left, 0), s.w), Math.min(Math.max(ev.clientY - r.top, 0), s.h), -(110 + speed() * 0.1));
          }
        }
        window.clearTimeout(dwell);
        pending = nextPanel;
        panel = nextPanel;
        if (nextPanel) dwell = window.setTimeout(() => { if (pending === nextPanel) startRipple(nextPanel); }, 140);
      } else if (panel) {
        const s = skins.get(panel);
        if (s && s.hover) {
          if (editing(panel)) s.hover = false;
          const r = panel.getBoundingClientRect();
          s.mx = (ev.clientX - r.left) * (s.w / r.width); s.my = (ev.clientY - r.top) * (s.h / r.height);
          if (speed() > 1200) strike(s, s.mx, s.my, speed() * 0.015);
        }
      }
      run();
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || !mouse) return;
      const t = e.timeStamp;
      if (pt) { const dt = Math.max(t - pt, 1) / 1000; pvx = 0.6 * pvx + 0.4 * ((e.clientX - px) / dt); pvy = 0.6 * pvy + 0.4 * ((e.clientY - py) / dt); }
      px = e.clientX; py = e.clientY; pt = t;
      ev = e;
      if (!moveFrame) moveFrame = requestAnimationFrame(onFrame);
    };
    const onLeave = () => {
      lastLit?.style.setProperty("--spec-o", "0"); lastLit = null;
      if (card) { const s = tiltOf(card); s.hover = false; s.tx = 0; s.ty = 0; s.ts = 1; s.tyy = 0; }
      if (panel) { const s = skins.get(panel); if (s) s.hover = false; }
      window.clearTimeout(dwell);
      card = panel = pending = null;
      run();
    };
    const onScroll = () => { if (panel) { const s = skins.get(panel); if (s) s.hover = false; window.clearTimeout(dwell); panel = pending = null; run(); } };

    // Press: squash on the way down, boing on release. Works with mouse, touch, pen and the keyboard.
    const pressable = (t: EventTarget | null) => {
      const el = (t as Element | null)?.closest?.("[data-press]") as HTMLElement | null;
      return el && !(el as HTMLButtonElement).disabled ? el : null;
    };
    let held: HTMLElement | null = null;
    const onDown = (e: PointerEvent) => {
      if (reduce.matches || e.button > 0) return;
      const el = pressable(e.target);
      if (!el) return;
      held = el; pressOf(el).down = true; run();
    };
    const onUp = () => { if (held) { const s = pressOf(held); s.down = false; s.sy.v += 0.6 * s.give; held = null; run(); } };
    const onKey = (e: KeyboardEvent) => {
      if (reduce.matches || (e.key !== "Enter" && e.key !== " ")) return;
      const el = pressable(document.activeElement);
      if (!el) return;
      const s = pressOf(el); s.sx.v += 1.2 * s.give; s.sy.v -= 2.2 * s.give; run();
    };
    const onReact = (e: Event) => {
      if (reduce.matches) return;
      const { el, kind, strength } = (e as CustomEvent).detail as { el: HTMLElement; kind: string; strength: number };
      if (!el?.isConnected) return;
      const s = pressOf(el);
      if (kind === "boing") { s.sy.v += 3.2 * strength; s.sx.v -= 2.2 * strength; }
      else { s.tx.v += 260 * strength; }
      run();
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onUp, { passive: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("nyaay:react", onReact);
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    document.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("nyaay:react", onReact);
      window.removeEventListener("scroll", onScroll, { capture: true });
      document.removeEventListener("pointerleave", onLeave);
      window.clearTimeout(dwell);
      if (raf) cancelAnimationFrame(raf);
      if (moveFrame) cancelAnimationFrame(moveFrame);
      for (const el of tilts.keys()) delete el.dataset.live;
      for (const el of presses.keys()) delete el.dataset.pl;
      for (const s of skins.values()) dropSkin(s);
    };
  }, []);
  return null;
}
