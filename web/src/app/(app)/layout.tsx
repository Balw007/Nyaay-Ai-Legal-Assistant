"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { CommandPalette } from "@/components/shell/command-palette";
import { useMe } from "@/lib/hooks";
import { Seal } from "@/components/shell/wordmark";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: me, isLoading } = useMe();
  const [menu, setMenu] = useState(false);
  const [palette, setPalette] = useState(false);
  const path = usePathname();
  useEffect(() => setMenu(false), [path]);

  if (isLoading || !me) {
    return <div className="grid min-h-screen place-items-center"><Seal className="h-10 w-10 text-xl animate-pulse" /></div>;
  }

  return (
    <div className="min-h-screen md:grid md:grid-cols-[248px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-brass focus:px-3 focus:py-1.5 focus:text-[#0a0e18]">Skip to content</a>
      <aside className="hidden md:block sticky top-0 h-screen"><Sidebar /></aside>
      <AnimatePresence>
        {menu && (
          <>
            <motion.div className="fixed inset-0 z-40 bg-black/50 md:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMenu(false)} />
            <motion.aside className="fixed inset-y-0 left-0 z-50 w-[264px] md:hidden" initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }} transition={{ type: "spring", damping: 30, stiffness: 300 }}>
              <Sidebar onNavigate={() => setMenu(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
      <div className="min-w-0">
        <Topbar onMenu={() => setMenu(true)} onSearch={() => setPalette(true)} />
        <main id="main" className="mx-auto w-full max-w-[1320px] px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
      <CommandPalette open={palette} setOpen={setPalette} />
    </div>
  );
}
