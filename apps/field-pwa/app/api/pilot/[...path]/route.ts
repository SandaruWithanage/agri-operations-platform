import { createLazyBffHandler } from "@agri/auth-bff";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Created once per server process (lazily, so a missing configuration still answers 503): the rate limiter
// inside the handler must outlive a single request or its budgets would never accumulate.
const handle = createLazyBffHandler(() => ({
  apiOrigin: process.env.PILOT_API_ORIGIN ?? "",
  publicOrigin: process.env.PILOT_PUBLIC_ORIGIN ?? "",
  internalKey: process.env.PILOT_INTERNAL_KEY ?? "",
  source: "field_officer",
  allowInsecureLocal: process.env.NODE_ENV !== "production",
  trustedProxyHops: Number(process.env.PILOT_TRUSTED_PROXY_HOPS ?? "0"),
}));
export const GET = handle;
export const POST = handle;
