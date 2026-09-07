import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { filterActiveEnrollments, effectiveMaxCandidates } from "@/lib/enrollment";
import { NextRequest } from "next/server";

// POST /api/slots/merge-undersized — admin : à la clôture des inscriptions
// d'une épreuve de groupe, fusionne les créneaux publiés restés sous
// `min_candidates` vers un autre créneau de la même épreuve ayant assez de
// place pour absorber TOUS ses candidats en une fois. Si aucune cible ne
// peut tout absorber, le créneau reste tel quel (pas de fusion partielle,
// pas d'échec bloquant — voir
// docs/superpowers/specs/2026-09-07-min-candidats-epreuves-groupe-design.md).
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const { epreuveId } = await req.json();
    if (!epreuveId) {
      return Response.json({ error: "epreuveId requis" }, { status: 400 });
    }

    const { data: epreuve, error: epErr } = await supabaseAdmin
      .from("epreuves")
      .select("id, name, is_group_epreuve, min_candidates, group_size")
      .eq("id", epreuveId)
      .single();
    if (epErr || !epreuve) {
      return Response.json({ error: "Épreuve introuvable" }, { status: 404 });
    }

    if (!epreuve.is_group_epreuve || !epreuve.min_candidates) {
      return Response.json({ merged: 0, movedCandidates: 0, notifiedCandidates: 0 });
    }

    const { data: slots, error: slotsErr } = await supabaseAdmin
      .from("evaluation_slots")
      .select(
        "id, date, start_time, end_time, room, max_candidates, enrollments:slot_enrollments(id, candidate_id, status)",
      )
      .eq("epreuve_id", epreuveId)
      .eq("status", "published")
      .order("date", { ascending: true })
      .order("start_time", { ascending: true });
    if (slotsErr) throw slotsErr;

    const withCapacity = (slots || []).map((s: any) => {
      const active = (s.enrollments || []).filter(filterActiveEnrollments);
      const max = effectiveMaxCandidates({ max_candidates: s.max_candidates, epreuve });
      return { ...s, active, remaining: max - active.length };
    });

    const minCandidates = epreuve.min_candidates;
    const undersized = withCapacity.filter(
      (s) => s.active.length > 0 && s.active.length < minCandidates,
    );

    let merged = 0;
    let movedCandidates = 0;
    let notifiedCandidates = 0;

    for (const source of undersized) {
      const target = withCapacity.find(
        (s) => s.id !== source.id && s.remaining >= source.active.length,
      );
      if (!target) continue; // aucune salle ne peut tout absorber → on laisse tel quel

      const enrollmentIds = source.active.map((e: any) => e.id);
      const { error: moveErr } = await supabaseAdmin
        .from("slot_enrollments")
        .update({ slot_id: target.id })
        .in("id", enrollmentIds);
      if (moveErr) {
        console.error("Fusion créneau sous-rempli — déplacement échoué:", moveErr);
        continue;
      }

      // Les examinateurs du créneau vidé n'ont plus de candidats à évaluer.
      await supabaseAdmin
        .from("slot_member_assignments")
        .delete()
        .eq("slot_id", source.id);

      const dateStr = new Date(target.date).toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
      });
      const rows = source.active.map((e: any) => ({
        sender_id: null,
        sender_role: "admin",
        sender_name: "Système",
        recipient_id: e.candidate_id,
        recipient_role: "candidate",
        message: `📅 Votre créneau "${epreuve.name}" a été regroupé avec un autre créneau (trop peu d'inscrits) : nouvelle date ${dateStr} à ${String(target.start_time).slice(0, 5)} (salle ${target.room || "—"}).`,
      }));
      try {
        await supabaseAdmin.from("private_messages").insert(rows);
        notifiedCandidates += rows.length;
      } catch (e) {
        console.error("Notification fusion créneau échec:", e);
      }

      // Met à jour la capacité restante de la cible pour les fusions suivantes.
      target.remaining -= source.active.length;
      target.active = target.active.concat(source.active);

      merged++;
      movedCandidates += source.active.length;
    }

    return Response.json({ merged, movedCandidates, notifiedCandidates });
  } catch (error) {
    console.error("Merge undersized slots error:", error);
    return Response.json(
      { error: "Échec de la fusion des créneaux sous-remplis", details: (error as any)?.message || String(error) },
      { status: 500 },
    );
  }
}
