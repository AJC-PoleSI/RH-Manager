import { runAutoAllocate } from "@/lib/auto-allocate";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// POST /api/slots/auto-allocate
// Triggers the auto-allocation algorithm (admin/system endpoint).
// In normal operation this runs implicitly after relevant events
// (availability change, publish-to-examinateurs, member unsubscribe).
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  try {
    const body = await req.json().catch(() => ({}));
    const result = await runAutoAllocate({ epreuveId: body.epreuveId });
    return Response.json(result);
  } catch (error) {
    console.error("auto-allocate error:", error);
    return Response.json(
      { error: "Allocation auto échouée", details: String(error) },
      { status: 500 },
    );
  }
}
