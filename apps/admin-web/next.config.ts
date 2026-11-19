/**
 * Security headers for every response. The policy only allows the app's own origin: no foreign scripts, frames,
 * plugins, <base> or form targets, and no network connections other than same-origin (the BFF). Next.js emits
 * inline bootstrap scripts and styles, so `unsafe-inline` is still required for them until a nonce-based policy
 * is introduced; that keeps XSS protection weaker than a nonce policy and must be revisited (it also conflicts
 * with the statically cached offline shell). `unsafe-eval` and websockets are allowed only in development.
 */
function securityHeaders(geolocation: "self" | "none") {
  const production = process.env.NODE_ENV === "production";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${production ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${production ? "" : " ws: wss:"}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
  const headers = [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    {
      key: "Permissions-Policy",
      value: `geolocation=${geolocation === "self" ? "(self)" : "()"}, camera=(), microphone=(), payment=(), usb=(), bluetooth=(), interest-cohort=()`,
    },
  ];
  // HSTS only where the site is served over HTTPS in production; browsers ignore it over plain HTTP.
  if (production)
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=31536000; includeSubDomains",
    });
  return headers;
}
export default {
  poweredByHeader: false,
  transpilePackages: [
    "@agri/auth-bff",
    "@agri/security-events",
    "@agri/design-tokens",
    "@agri/ui",
    "@agri/i18n",
    "@agri/sync-client",
    "@agri/validation",
  ],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders("self") }];
  },
  experimental: { cpus: 2 },
};
