"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { Toaster } from "sonner";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { TransitionProvider } from "@/lib/transition";
import { Specular } from "@/components/shell/specular";
import { WelcomeIntro } from "@/components/brand/welcome";

type Theme = "light" | "dark";
const ThemeCtx = createContext<{ theme: Theme; toggle: () => void }>({ theme: "dark", toggle: () => {} });
export const useTheme = () => useContext(ThemeCtx);

function readTheme(): Theme {
  try {
    const t = localStorage.getItem("nyaay-theme");
    if (t === "dark" || t === "light") return t;
  } catch {}
  return "dark"; // Nyaay is dark-first; light mode is one click away
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000, refetchOnWindowFocus: false,
        retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 1,
      },
    },
  }));
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => { setTheme(readTheme()); }, []);
  // Apply the theme; persist it only when the user changes it (an effect that also saved would race the
  // initial read under React Strict Mode's double effects and overwrite the stored choice).
  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#f3f2ee" : "#05080f");
  }, [theme]);
  useEffect(() => {
    // Installable app: register the service worker in production only (it never caches legal data)
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  const toggle = useCallback(() => setTheme((t) => {
    const next = t === "dark" ? "light" : "dark";
    try { localStorage.setItem("nyaay-theme", next); } catch {}
    return next;
  }), []);

  return (
    <ThemeCtx.Provider value={{ theme, toggle }}>
      <QueryClientProvider client={client}>
        <MotionConfig reducedMotion="user">
          <TransitionProvider>
            <div className="atmosphere" aria-hidden />
            <Specular />
            {children}
            <WelcomeIntro />
          </TransitionProvider>
        </MotionConfig>
        <Toaster position="bottom-right" theme={theme} toastOptions={{ classNames: { toast: "!font-sans !text-base !rounded-xl" } }} />
      </QueryClientProvider>
    </ThemeCtx.Provider>
  );
}
