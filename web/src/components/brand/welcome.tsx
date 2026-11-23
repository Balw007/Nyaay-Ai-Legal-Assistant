"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Volume2, VolumeX } from "lucide-react";

const KEY = "nyaay-intro-played";

/**
 * The welcome: the cinematic न्याय intro, once per browser session, over whatever page opens first.
 * It plays to the end; there is no skip button. Esc still closes it, so a keyboard user is never trapped.
 * It starts muted (browsers block sound until you interact); a button turns sound on.
 * People who ask their system for reduced motion never see it play.
 * Replay any time from the user menu (it dispatches "nyaay:intro").
 *
 * Smoothness: the video is 60 fps like the original. It starts only once the browser can play it through without
 * stopping, the poster shows until then, and the app underneath is hidden while it plays so nothing else is drawn.
 */
export function WelcomeIntro() {
  const [show, setShow] = useState(false);
  const [ready, setReady] = useState(false);
  const [muted, setMuted] = useState(true);
  const [src, setSrc] = useState("/brand/intro-1080.mp4");
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setSrc(window.innerWidth < 900 ? "/brand/intro-720.mp4" : "/brand/intro-1080.mp4");
    let seen = false;
    try { seen = sessionStorage.getItem(KEY) === "1"; } catch {}
    if (!seen && !reduce && !navigator.webdriver) setShow(true);
    const replay = () => { setReady(false); setShow(true); };
    window.addEventListener("nyaay:intro", replay);
    return () => window.removeEventListener("nyaay:intro", replay);
  }, []);

  const close = useCallback(() => {
    try { sessionStorage.setItem(KEY, "1"); } catch {}
    setShow(false);
  }, []);

  // Hide the app while the intro is on screen, so the browser spends its time on the video alone.
  useEffect(() => {
    const root = document.documentElement;
    if (show) root.dataset.intro = "1";
    else delete root.dataset.intro;
    return () => { delete root.dataset.intro; };
  }, [show]);

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show, close]);

  useEffect(() => {
    if (show && ready) video.current?.play().catch(() => {});
  }, [show, ready]);

  // If the video never becomes playable, do not hold the person at a still frame.
  useEffect(() => {
    if (!show || ready) return;
    const t = window.setTimeout(close, 8000);
    return () => window.clearTimeout(t);
  }, [show, ready, close]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div key="intro" data-welcome role="dialog" aria-modal="true" aria-label="Welcome to Nyaay"
          className="fixed inset-0 z-[100] grid place-items-center overflow-hidden bg-[#050a1c]"
          initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}>
          <video ref={video} src={src} poster="/brand/intro-poster.webp" muted={muted} playsInline preload="auto"
            onCanPlayThrough={() => setReady(true)} onEnded={close} onError={close}
            className="h-full w-full object-cover" aria-hidden />
          <button onClick={() => { const m = !muted; setMuted(m); if (video.current) video.current.muted = m; }}
            aria-label={muted ? "Turn sound on" : "Turn sound off"}
            className="absolute bottom-6 right-6 grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-black/40 text-white/80 hover:bg-black/60">
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
