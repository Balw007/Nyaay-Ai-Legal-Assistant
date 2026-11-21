import type { NextConfig } from "next";

// The browser talks only to this Next.js server; /api/* is forwarded to the FastAPI backend.
// Same origin means the backend's httpOnly session cookie works with no CORS setup.
const API = process.env.NYAAI_API ?? "http://127.0.0.1:8000";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // AI answers and OCR can take minutes on a laptop without a GPU, and scanned orders can be large.
    // The defaults (about 30 seconds, 10 MB) would cut those requests off.
    proxyTimeout: 15 * 60 * 1000,
    proxyClientMaxBodySize: "60mb",
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API}/:path*` }];
  },
};

export default config;
