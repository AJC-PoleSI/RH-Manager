import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import {
  filterActiveEnrollments,
  effectiveMaxCandidates,
} from "@/lib/enrollment";
import { NextRequest } from "next/server";
export const dynamic = "force-dynamic";

// GET /api/slots/my-slots — member's assigned slots
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const memberId = payload.id;

  try {
    const { data: assignments, error } = await supabaseAdmin
      .from("slot_member_assignments")
      .select(
        `
        *,
        slot:evaluation_slots(
          *,
          epreuve:epreuves(id, name, tour, type, is_group_epreuve, group_size),
          enrollments:slot_enrollments(*, candidate:candidates(id, first_name, last_name)),
          members:slot_member_assignments(*, member:members(email))
        )
      `,
      )
      .eq("member_id", memberId);

    if (error) throw error;

    const slots = (assignments || [])
      .filter(
        (a: any) =>
          a.slot &&
          a.slot.epreuve &&
          // FIX C1 + (audit #1): include ALL relevant statuses. A member
          // who declares availability gets auto-assigned even before the
          // slot reaches min_members (slot stays "open"). Excluding
          // "open" hid the slot from the very member who just picked it
          // — the exact complaint "je coche dispo, le slot n'apparaît
          // pas côté membre". Now: any assigned slot shows up, with
          // status badge so the member knows it's not yet confirmed.
          [
            "draft",
            "open",
            "ready",
            "published",
            "full",
            "closed",
          ].includes(a.slot.status),
      )
      .map((a: any) => ({
        ...a.slot,
        // FIX C2: drop cancelled enrollments from member's view so admin
        // and member see the same active candidate list.
        enrollments: (a.slot.enrollments || []).filter(
          filterActiveEnrollments,
        ),
        myAssignment: true,
      }))
      .sort((a: any, b: any) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        return (
          dateA - dateB ||
          (a.start_time || "").localeCompare(b.start_time || "")
        );
      });

    // FIX C4: explicit no-store so browsers/Axios don't serve stale data
    // after a candidate enrolls and the slot transitions to full/ready.
    return new Response(JSON.stringify(slots), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    return Response.json(
      { error: "Failed to fetch my slots" },
      { status: 500 },
    );
  }
}
