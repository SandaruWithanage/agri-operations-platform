import { createBffHandler } from "@agri/auth-bff";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request): Promise<Response> {
  try {
    const handler = createBffHandler({
      apiOrigin: process.env.PILOT_API_ORIGIN ?? "",
      publicOrigin: process.env.PILOT_PUBLIC_ORIGIN ?? "",
      internalKey: process.env.PILOT_INTERNAL_KEY ?? "",
      source: "administrator",
      allowInsecureLocal: process.env.NODE_ENV !== "production",
    });
    return handler(request);
  } catch {
    return Response.json(
      { error: "Authentication is not configured" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
export const GET = handle;
export const POST = handle;
