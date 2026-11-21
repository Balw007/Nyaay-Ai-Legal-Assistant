"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ApiError } from "@/lib/api";

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
  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    try { localStorage.setItem("nyaay-theme", theme); } catch {}
  }, [theme]);
  const toggle = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);

  return (
    <ThemeCtx.Provider value={{ theme, toggle }}>
      <QueryClientProvider client={client}>
        {children}
        <Toaster position="bottom-right" theme={theme} toastOptions={{ classNames: { toast: "!font-sans !text-base" } }} />
      </QueryClientProvider>
    </ThemeCtx.Provider>
  );
}
