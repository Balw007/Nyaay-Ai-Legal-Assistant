"use client";
import { useEffect, useRef } from "react";
import { Ribbon } from "@/components/fx/ribbon";

// Screens where people read judgments, write drafts or fill in forms get a plain background.
const CALM = ["/judgments", "/drafts", "/citations", "/settings"];
export const hasRibbon = (path: string) => !CALM.some((p) => path.startsWith(p));

/** The background layer behind a whole screen: moving on Home, one faint still frame on other work screens. */
export function PageRibbon({ path }: { path: string }) {
  const home = path === "/";
  const layer = useRef<HTMLDivElement>(null);
  // On Home the light dims as you scroll into your work.
  useEffect(() => {
    const el = layer.current;
    if (!el || !home) return;
    const dim = () => { el.style.opacity = String(Math.max(0.3, 1 - window.scrollY / 700)); };
    dim();
    window.addEventListener("scroll", dim, { passive: true });
    return () => { window.removeEventListener("scroll", dim); el.style.opacity = ""; };
  }, [home]);
  if (!hasRibbon(path)) return null;
  return (
    <div ref={layer} aria-hidden className="pointer-events-none fixed inset-0 -z-10 print:hidden">
      {home ? <Ribbon key="home" shape="home" /> : <Ribbon key="quiet" shape="quiet" live={false} intensity={0.14} />}
    </div>
  );
}
