/**
 * Runs once when the server starts (not while building). The Node-only work lives in a separate module that is
 * imported only here, the pattern Next.js recommends, so the Edge bundle never sees Node APIs. See SEC-A1.
 */
export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  )
    await import("./instrumentation-node");
}
