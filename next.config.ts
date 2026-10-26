import type { NextConfig } from "next";

/**
 * Headers that can never break rendering.
 *
 * The CSP is deliberately narrow: `frame-ancestors`, `base-uri`, `form-action`
 * and `object-src` stop clickjacking, `<base>` injection and form exfiltration,
 * and none of them touch scripts, styles or network calls. A `script-src` policy
 * needs a nonce piped through the proxy, because Next injects inline bootstrap
 * scripts; shipping `'unsafe-inline'` instead would look like protection without
 * being any. That work is tracked as D44's follow-up, not pretended here.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
