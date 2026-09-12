import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { isActiveEnrollment } from "@/lib/enrollment";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/candidates/[id]/slots — le planning d'un candidat.
 *
 * Pour chaque créneau où le candidat a une inscription ACTIVE : l'épreuve, la
 * salle, l'horaire et les examinateurs affectés. C'est ce que le staff cherche
 * quand il ouvre une fiche : « il passe quand, où, et avec qui ? » — sans
 * devoir fouiller le planning général.
 *
 * SÉCURITÉ : réservé au staff, exactement comme /api/slots/all. La composition
 * du jury ne doit jamais fuiter vers un candidat ; son propre planning lui est
 * servi (sans les examinateurs) par /api/slots/my-enrollments.
 */
export async function GET(req: NextRequest, context: RouteContext) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (payload.role === "candidate") return forbidden();

  const { id } = await context.params;

  try {
    const { data, error } = await supabaseAdmin
      .from("slot_enrollments")
      .select(
        `
        id, status, enrolled_at, slot_id,
        slot:evaluation_slots(
          id, date, start_time, end_time, duration_minutes, room, label, status, tour,
          epreuve:epreuves(id, name, tour, type, is_group_epreuve),
          members:slot_member_assignments(member:members(id, email, first_name, last_name))
        )
      `,
      )
      .eq("candidate_id", id);

    if (error) throw error;

    const slots = (data || [])
      // Une désinscription ne doit pas apparaître au planning du candidat.
      .filter((e: any) => isActiveEnrollment(e.status))
      .filter((e: any) => e.slot)
      .map((e: any) => {
        const s = e.slot;
        return {
          enrollmentId: e.id,
          slotId: s.id,
          date: s.date,
          startTime: s.start_time,
          endTime: s.end_time,
          durationMinutes: s.duration_minutes,
          room: s.room || null,
          label: s.label || null,
          slotStatus: s.status,
          tour: s.epreuve?.tour ?? s.tour ?? null,
          enrolledAt: e.enrolled_at,
          epreuve: s.epreuve
            ? {
                id: s.epreuve.id,
                name: s.epreuve.name,
                tour: s.epreuve.tour,
                type: s.epreuve.type,
                isGroupEpreuve: !!s.epreuve.is_group_epreuve,
              }
            : null,
          examiners: (s.members || [])
            .map((a: any) => a.member)
            .filter(Boolean)
            .map((m: any) => ({
              id: m.id,
              email: m.email,
              // Les membres importés n'ont pas toujours de nom : l'email reste
              // le seul identifiant lisible.
              name:
                [m.first_name, m.last_name].filter(Boolean).join(" ").trim() ||
                m.email,
            }))
            .sort((a: any, b: any) => a.name.localeCompare(b.name, "fr")),
        };
      })
      .sort((a: any, b: any) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        return (
          dateA - dateB || (a.startTime || "").localeCompare(b.startTime || "")
        );
      });

    return new Response(JSON.stringify(slots), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        // Le planning bouge à chaque dispatch : jamais de cache navigateur.
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    console.error("GET /api/candidates/[id]/slots error:", error);
    return Response.json(
      { error: "Échec du chargement des créneaux du candidat" },
      { status: 500 },
    );
  }
}
