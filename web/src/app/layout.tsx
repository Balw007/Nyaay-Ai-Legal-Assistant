import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: { default: "Nyaay", template: "%s · Nyaay" },
  description: "Legal workspace for Indian advocates: research, matters, deadlines and drafting with verified citations.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Nyaay", statusBarStyle: "black-translucent" },
};
export const viewport: Viewport = { themeColor: "#05080f", width: "device-width", initialScale: 1, viewportFit: "cover" };

// Dark is the default; set the light class before paint so it never flashes.
const themeScript = `try{if(localStorage.getItem('nyaay-theme')==='light')document.documentElement.classList.add('light')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
