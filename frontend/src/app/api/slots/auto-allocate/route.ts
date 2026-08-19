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
  // SECURITY (audit du 19/08/2026, point #11) : opération lourde qui recalcule
  // tout le planning. Elle est légitimement déclenchée par un membre qui
  // enregistre ses disponibilités, mais un CANDIDAT n'a rien à y faire.
  if (payload.role !== "member") {
    return Response.json({ error: "Acces interdit" }, { status: 403 });
  }

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
