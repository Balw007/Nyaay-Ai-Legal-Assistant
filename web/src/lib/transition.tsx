"use client";
// Shared-element navigation. When a result card opens a judgment, or a matter card opens its workspace,
// the card morphs into the destination's header instead of the screen being replaced.
//
// How: the View Transitions API snapshots the old page, we push the route, and resolve the update once
// the new pathname has committed. The clicked element and the destination hero share the name `vt-hero`.
// `prepare` prefetches the destination's data so its hero is on screen when the new snapshot is taken.
// Browsers without the API, and users who prefer reduced motion, get an ordinary navigation.
import { createContext, useCallback, useContext, useLayoutEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

type NavOpts = { source?: HTMLElement | null; prepare?: () => Promise<unknown> };
type Navigate = (href: string, opts?: NavOpts) => void;

const Ctx = createContext<Navigate>(() => {});
export const useNavigate = () => useContext(Ctx);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function TransitionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const resolver = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    if (resolver.current) {
      const r = resolver.current;
      resolver.current = null;
      // One frame so the destination's hero has laid out before the new snapshot.
      requestAnimationFrame(() => r());
    }
  }, [path]);

  const navigate = useCallback<Navigate>(async (href, opts = {}) => {
    const { source, prepare } = opts;
    if (prepare) await Promise.race([prepare().catch(() => {}), sleep(250)]);
    const doc = document as Document & { startViewTransition?: (cb: () => Promise<void>) => { finished: Promise<void> } };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const target = new URL(href, location.href);
    if (!doc.startViewTransition || reduce || target.pathname === location.pathname) { router.push(href); return; }

    document.querySelectorAll<HTMLElement>(".vt-hero").forEach((el) => { el.style.viewTransitionName = "none"; });
    if (source) source.style.viewTransitionName = "vt-hero";
    document.documentElement.dataset.vt = "1";
    try {
      const t = doc.startViewTransition(() => new Promise<void>((res) => {
        resolver.current = res;
        router.push(href);
        setTimeout(res, 600); // never hold the screen if the route is slow
      }));
      t.finished.finally(() => {
        delete document.documentElement.dataset.vt;
        if (source) source.style.viewTransitionName = "";
      });
    } catch {
      delete document.documentElement.dataset.vt;
      router.push(href);
    }
  }, [router]);

  return <Ctx.Provider value={navigate}>{children}</Ctx.Provider>;
}

/** Link that morphs into its destination. Keeps native link semantics (middle-click, open in new tab). */
export function MorphLink({ href, prepare, morph = true, className, children, onClick, ...rest }:
  { href: string; prepare?: () => Promise<unknown>; morph?: boolean } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const navigate = useNavigate();
  return (
    <a href={href} className={className} {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        const source = morph ? ((e.currentTarget.closest("[data-morph]") as HTMLElement | null) ?? e.currentTarget) : null;
        navigate(href, { source, prepare });
      }}>
      {children}
    </a>
  );
}
