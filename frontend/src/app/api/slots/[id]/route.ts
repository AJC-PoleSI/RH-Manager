import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { NextRequest } from "next/server";

// PUT /api/slots/[id] — update a slot (admin)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  const { id } = await params;

  try {
    const {
      label,
      maxCandidates,
      minMembers,
      simultaneousSlots,
      status,
      room,
      epreuveId,
      startTime,
      endTime,
      durationMinutes,
      tour,
    } = await req.json();

    const data: Record<string, any> = {};
    if (label !== undefined) data.label = label;
    if (maxCandidates !== undefined) data.max_candidates = maxCandidates;
    if (minMembers !== undefined) data.min_members = minMembers;
    if (simultaneousSlots !== undefined)
      data.simultaneous_slots = simultaneousSlots;
    if (status !== undefined) data.status = status;
    if (room !== undefined) data.room = room;
    if (epreuveId !== undefined) data.epreuve_id = epreuveId || null;
    if (startTime !== undefined) data.start_time = startTime;
    if (endTime !== undefined) data.end_time = endTime;
    // duration_minutes : recalcul depuis start/end pour rester cohérent
    if (startTime !== undefined && endTime !== undefined) {
      const t2m = (t: string) => {
        const [h, m] = t.split(":").map(Number);
        return h * 60 + (m || 0);
      };
      data.duration_minutes = Math.max(1, t2m(endTime) - t2m(startTime));
    } else if (durationMinutes !== undefined) {
      data.duration_minutes = durationMinutes;
    }
    if (tour !== undefined) data.tour = tour;

    // ══════════════════════════════════════════════════════════════════
    // Anti-chevauchement (déplacement / changement de salle / d'horaire)
    // ══════════════════════════════════════════════════════════════════
    if (
      startTime !== undefined ||
      endTime !== undefined ||
      room !== undefined
    ) {
      const { data: current } = await supabaseAdmin
        .from("evaluation_slots")
        .select("date, start_time, end_time, room")
        .eq("id", id)
        .single();
      if (current) {
        const effectiveRoom = room !== undefined ? room : current.room;
        const effectiveStart = String(
          startTime !== undefined ? startTime : current.start_time,
        ).slice(0, 5);
        const effectiveEnd = String(
          endTime !== undefined ? endTime : current.end_time,
        ).slice(0, 5);
        const dateStr = String(current.date).split("T")[0];
        const t2m = (t: string) => {
          const [h, m] = t.split(":").map(Number);
          return h * 60 + (m || 0);
        };
        const newStart = t2m(effectiveStart);
        const newEnd = t2m(effectiveEnd);

        if (effectiveRoom) {
          const { data: sameRoomSlots } = await supabaseAdmin
            .from("evaluation_slots")
            .select("id, start_time, end_time")
            .eq("room", effectiveRoom)
            .like("date", `${dateStr}%`)
            .neq("id", id);

          const overlap = (sameRoomSlots || []).find((s: any) => {
            const sStart = t2m(String(s.start_time).slice(0, 5));
            const sEnd = t2m(String(s.end_time).slice(0, 5));
            return newStart < sEnd && sStart < newEnd;
          });
          if (overlap) {
            return Response.json(
              {
                error: `Chevauchement : ${effectiveRoom} a déjà un créneau ${String(overlap.start_time).slice(0, 5)}–${String(overlap.end_time).slice(0, 5)} ce jour-là.`,
              },
              { status: 409 },
            );
          }
        }
      }
    }

    const { data: slot, error } = await supabaseAdmin
      .from("evaluation_slots")
      .update(data)
      .eq("id", id)
      .select(
        `
        *,
        epreuve:epreuves(name, tour, type),
        members:slot_member_assignments(*, member:members(id, email)),
        enrollments:slot_enrollments(*, candidate:candidates(id, first_name, last_name)),
        requests:slot_availability_requests(*, member:members(id, email))
      `,
      )
      .single();

    if (error) throw error;

    return Response.json(slot);
  } catch (error) {
    console.error("Update slot error:", error);
    return Response.json({ error: "Failed to update slot" }, { status: 500 });
  }
}

// DELETE /api/slots/[id] — delete a slot (admin)
// Notifie les candidats inscrits avant suppression.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  const { id } = await params;

  try {
    // 1. Récupérer les infos du créneau + ses candidats inscrits AVANT suppression
    const { data: slot } = await supabaseAdmin
      .from("evaluation_slots")
      .select(
        `
        id, date, start_time, end_time, room,
        epreuve:epreuves(name),
        enrollments:slot_enrollments(candidate_id, candidate:candidates(id, first_name, last_name))
        `,
      )
      .eq("id", id)
      .single();

    // 2. Notifier les candidats inscrits via private_messages
    const enrollments = (slot as any)?.enrollments || [];
    if (enrollments.length > 0) {
      const dateStr = slot?.date
        ? new Date(slot.date).toLocaleDateString("fr-FR", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })
        : "";
      const startTime = String(slot?.start_time || "").substring(0, 5);
      const epName = (slot as any)?.epreuve?.name || "Épreuve";
      const room = slot?.room || "—";

      const rows = enrollments.map((e: any) => ({
        sender_id: null,
        sender_role: "admin",
        sender_name: "Système",
        recipient_id: e.candidate_id,
        recipient_role: "candidate",
        message: `⚠️ Votre créneau "${epName}" du ${dateStr} à ${startTime} (salle ${room}) a été annulé par l'administration. Merci de vous réinscrire à un autre créneau disponible.`,
      }));

      try {
        await supabaseAdmin.from("private_messages").insert(rows);
      } catch (e) {
        console.error("Notification candidats échec:", e);
      }
    }

    // 3. Supprimer le créneau (cascade sur enrollments/assignments via FK)
    const { error } = await supabaseAdmin
      .from("evaluation_slots")
      .delete()
      .eq("id", id);

    if (error) throw error;

    return Response.json({
      success: true,
      notified_candidates: enrollments.length,
    });
  } catch (error) {
    console.error("Delete slot error:", error);
    return Response.json({ error: "Failed to delete slot" }, { status: 500 });
  }
}
