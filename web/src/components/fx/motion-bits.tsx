"use client";
import { useEffect, useRef } from "react";
import { animate, motion, useReducedMotion } from "motion/react";
import Lenis from "@/lib/vendor/lenis.mjs";
import { ease } from "@/lib/motion";

/** A heading whose words come into focus one after another. Screen readers get the sentence once. */
export function Sharpen({ text, delay = 0 }: { text: string; delay?: number }) {
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {text.split(" ").map((w, i) => (
          <span key={i}>
            <span className="sharpen-word" style={{ animationDelay: `${delay + i * 0.09}s` }}>{w}</span>{" "}
          </span>
        ))}
      </span>
    </>
  );
}

/** Counts up to a real number and ends on exactly that number. */
export function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const from = useRef(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const show = (n: number) => { el.textContent = Math.round(n).toLocaleString("en-IN"); };
    if (reduce || navigator.webdriver) { show(value); from.current = value; return; }
    const run = animate(from.current, value, { duration: 1.1, ease: ease.out, onUpdate: (n) => { from.current = n; show(n); }, onComplete: () => show(value) });
    return () => run.stop();
  }, [value, reduce]);
  return (
    <>
      <span className="sr-only">{value.toLocaleString("en-IN")}</span>
      <span aria-hidden ref={ref}>{value.toLocaleString("en-IN")}</span>
    </>
  );
}

/** Rises into place the first time it is scrolled into view. */
export function Rise({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 28 }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -40px 0px" }} transition={{ duration: 0.7, ease: ease.out, delay }}>
      {children}
    </motion.div>
  );
}

/** Weighted scrolling for the screen that mounts it (Home). Dialogs and inner scrolling areas keep native scrolling. */
export function useSmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({
      lerp: 0.1, wheelMultiplier: 0.95, autoRaf: true, allowNestedScroll: true,
      prevent: (node) => node.getAttribute?.("role") === "dialog" || node.getAttribute?.("role") === "listbox" || node.getAttribute?.("role") === "menu",
    });
    return () => lenis.destroy();
  }, []);
}
