"use client";
import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Rail, RAIL_COLLAPSED, RAIL_EXPANDED } from "@/components/shell/rail";
import { CommandBar } from "@/components/shell/command-bar";
import { CommandPalette, type PaletteMode } from "@/components/shell/command-palette";
import { Dock } from "@/components/shell/dock";
import { ShortcutsDialog, useShortcuts } from "@/components/shell/shortcuts";
import { BootSeal } from "@/components/shell/wordmark";
import { useMe } from "@/lib/hooks";
import { spring } from "@/lib/motion";

function usePinned() {
  // The full navigation bar is open by default; the pin button collapses it to icons and remembers that.
  const [pinned, set] = useState(true);
  useEffect(() => { try { set(localStorage.getItem("nyaay-rail-pinned") !== "0"); } catch {} }, []);
  const setPinned = useCallback((v: boolean) => { set(v); try { localStorage.setItem("nyaay-rail-pinned", v ? "1" : "0"); } catch {} }, []);
  return [pinned, setPinned] as const;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: me, isLoading } = useMe();
  const [menu, setMenu] = useState(false);
  const [palette, setPalette] = useState(false);
  const [mode, setMode] = useState<PaletteMode>("search");
  const [help, setHelp] = useState(false);
  const [pinned, setPinned] = usePinned();
  const path = usePathname();
  useEffect(() => setMenu(false), [path]);

  const openSearch = useCallback(() => { setMode("search"); setPalette(true); }, []);
  const openAsk = useCallback(() => { setMode("ask"); setPalette(true); }, []);
  const openHelp = useCallback(() => setHelp(true), []);
  useShortcuts({ onSearch: openSearch, onAsk: openAsk, onHelp: openHelp });
  useEffect(() => {
    window.addEventListener("nyaay:ask", openAsk);
    window.addEventListener("nyaay:search", openSearch);
    return () => { window.removeEventListener("nyaay:ask", openAsk); window.removeEventListener("nyaay:search", openSearch); };
  }, [openAsk, openSearch]);

  if (isLoading || !me) return <BootSeal />;

  const gutter = (pinned ? RAIL_EXPANDED : RAIL_COLLAPSED) + 12;

  return (
    <div className="min-h-screen" style={{ ["--rail-space" as string]: `${gutter}px` }}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-brass focus:px-3 focus:py-1.5 focus:text-on-brass">Skip to content</a>

      <aside className="fixed bottom-3 left-3 top-3 z-40 hidden md:block"><Rail pinned={pinned} setPinned={setPinned} /></aside>

      <AnimatePresence>
        {menu && (
          <>
            <motion.div className="fixed inset-0 z-40 bg-[#02040a]/55 backdrop-blur-[3px] md:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMenu(false)} />
            <motion.aside className="fixed inset-x-3 bottom-3 top-14 z-50 md:hidden" initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }} transition={spring.smooth}>
              <Rail pinned mobile onNavigate={() => setMenu(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="min-w-0 pb-24 transition-[padding] duration-300 [transition-timing-function:var(--ease-out)] md:pb-10 md:pl-[var(--rail-space)]">
        <CommandBar onSearch={openSearch} onAsk={openAsk} onShortcuts={openHelp} />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1400px] px-4 pt-6 outline-none md:px-6 md:pt-8 lg:px-8">{children}</main>
      </div>

      <Dock onMenu={() => setMenu(true)} />
      <CommandPalette open={palette} setOpen={setPalette} mode={mode} onShortcuts={openHelp} />
      <ShortcutsDialog open={help} onClose={() => setHelp(false)} />
    </div>
  );
}
