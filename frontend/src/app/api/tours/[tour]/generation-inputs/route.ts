import { supabaseAdmin } from "@/lib/supabase";
import {
  getTokenFromRequest,
  unauthorized,
  forbidden,
  isSuperAdminEmail,
} from "@/lib/auth";
import { fetchAllRows } from "@/lib/supabase-paging";
import { readRoomList } from "@/lib/rooms-db";
import {
  expectedCandidatesFor,
  eligibleMembersFor,
  type DelibRow,
  type WishRow,
} from "@/lib/generation-inputs";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/tours/[tour]/generation-inputs?start=AAAA-MM-JJ&end=AAAA-MM-JJ
//
// Tout ce dont le bouton « Générer le Tour N » (TourOpeningsPanel +
// lib/tour-generator.ts) a besoin, calculé CÔTÉ SERVEUR en une seule fois :
//   - par épreuve du tour : candidats attendus, créneaux déjà existants,
//     membres éligibles (le pôle pour une épreuve de pôle, sinon tous) ;
//   - les réservations existantes sur [start, end] : membres déjà affectés
//     (toutes épreuves, tous tours) et salles déjà prises ;
//   - la liste commune des salles.
// Les dispos, elles, sont lues par le client via /api/availability/all comme
// pour la courbe de capacité.
//
// SECURITY : admin uniquement. La réponse révèle l'effectif par pôle et la
// tension candidats/membres pôle par pôle.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tour: string }> },
) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  const { tour } = await params;
  const tourNum = Number(tour);
  if (!Number.isInteger(tourNum) || tourNum < 1) {
    return Response.json({ error: "Tour invalide" }, { status: 400 });
  }
  const start = req.nextUrl.searchParams.get("start");
  const end = req.nextUrl.searchParams.get("end");
  const isYmd = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (!isYmd(start) || !isYmd(end) || start > end) {
    return Response.json(
      { error: "start et end requis (AAAA-MM-JJ, start ≤ end)" },
      { status: 400 },
    );
  }

  try {
    const [
      epreuvesRes,
      settingsRes,
      candidatesRes,
      delibsRes,
      wishesRes,
      membersRes,
      slotsRes,
      assignsRes,
      roomList,
    ] = await Promise.all([
      supabaseAdmin
        .from("epreuves")
        .select(
          "id, name, type, is_group_epreuve, is_pole_test, pole, duration_minutes, roulement_minutes, min_evaluators_per_salle, group_size, min_candidates, date_debut, date_fin, heure_debut_journee, heure_fin_journee",
        )
        .eq("tour", tourNum)
        .neq("type", "commune")
        .order("name"),
      supabaseAdmin
        .from("tour_settings")
        .select("candidats_attendus, marge_pct")
        .eq("tour", tourNum)
        .maybeSingle(),
      fetchAllRows<{ id: string }>((from, to) =>
        supabaseAdmin.from("candidates").select("id").order("id").range(from, to),
      ),
      fetchAllRows<DelibRow>((from, to) =>
        supabaseAdmin
          .from("deliberations")
          .select("candidate_id, tour1_status, tour2_status, tour3_status")
          .order("candidate_id")
          .range(from, to),
      ),
      fetchAllRows<WishRow>((from, to) =>
        supabaseAdmin
          .from("candidate_wishes")
          .select("candidate_id, pole")
          .order("id")
          .range(from, to),
      ),
      fetchAllRows<{
        id: string;
        email: string;
        first_name: string | null;
        last_name: string | null;
        pole: string | null;
      }>((from, to) =>
        supabaseAdmin
          .from("members")
          .select("id, email, first_name, last_name, pole")
          .order("id")
          .range(from, to),
      ),
      // Créneaux existants sur la période, toutes épreuves : la salle est
      // prise. Les annulés ne bloquent rien.
      fetchAllRows<{
        id: string;
        epreuve_id: string | null;
        date: string;
        start_time: string;
        end_time: string;
        room: string | null;
        status: string | null;
      }>((from, to) =>
        supabaseAdmin
          .from("evaluation_slots")
          .select("id, epreuve_id, date, start_time, end_time, room, status")
          .gte("date", `${start}T00:00:00`)
          .lte("date", `${end}T23:59:59`)
          .order("id")
          .range(from, to),
      ),
      // Affectations existantes sur la période : le membre est pris.
      fetchAllRows<{
        member_id: string;
        slot: { date: string; start_time: string; end_time: string; status: string | null } | null;
      }>((from, to) =>
        supabaseAdmin
          .from("slot_member_assignments")
          .select("member_id, slot:evaluation_slots!inner(date, start_time, end_time, status)")
          .gte("slot.date", `${start}T00:00:00`)
          .lte("slot.date", `${end}T23:59:59`)
          .order("id")
          .range(from, to),
      ),
      readRoomList(),
    ]);

    if (epreuvesRes.error) throw epreuvesRes.error;
    if (settingsRes.error) throw settingsRes.error;
    for (const r of [candidatesRes, delibsRes, wishesRes, membersRes, slotsRes, assignsRes]) {
      if (r.error) throw r.error;
    }

    const members = (membersRes.data || []).filter((m) => !isSuperAdminEmail(m.email));
    const candidateIds = (candidatesRes.data || []).map((c) => c.id);
    const deliberations = delibsRes.data || [];
    const wishes = wishesRes.data || [];
    const margePct = settingsRes.data?.marge_pct ?? 25;
    const tourCandidatsAttendus = settingsRes.data?.candidats_attendus ?? null;

    const isCancelled = (status: string | null | undefined) =>
      status === "cancelled" || status === "annule" || status === "annulé";

    // Créneaux déjà existants par épreuve (TOUTES dates, pas seulement la
    // période affichée) : c'est ce qui compte dans « déjà produit ».
    const existingByEpreuve = new Map<string, number>();
    {
      const { data, error } = await fetchAllRows<{ epreuve_id: string | null; status: string | null }>(
        (from, to) =>
          supabaseAdmin
            .from("evaluation_slots")
            .select("epreuve_id, status")
            .in("epreuve_id", (epreuvesRes.data || []).map((e: any) => e.id))
            .order("id")
            .range(from, to),
      );
      if (error) throw error;
      for (const s of data || []) {
        if (!s.epreuve_id || isCancelled(s.status)) continue;
        existingByEpreuve.set(s.epreuve_id, (existingByEpreuve.get(s.epreuve_id) || 0) + 1);
      }
    }

    const knownPoles = Array.from(
      new Set(members.map((m) => (m.pole || "").trim()).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b, "fr"));

    const epreuves = (epreuvesRes.data || []).map((e: any) => {
      const isPoleTest = !!e.is_pole_test && !!e.pole;
      const expectedIds = expectedCandidatesFor({
        tour: tourNum,
        isPoleTest,
        pole: e.pole || null,
        candidateIds,
        deliberations,
        wishes,
      });
      // Épreuve ouverte à tous : l'effectif saisi pour le tour prime (il
      // peut anticiper une délibération pas encore saisie), sinon le calcul.
      const expectedCandidates =
        !isPoleTest && tourCandidatsAttendus ? tourCandidatsAttendus : expectedIds.length;
      const eligibleMemberIds = eligibleMembersFor({
        isPoleTest,
        pole: e.pole || null,
        members,
      });
      return {
        id: e.id,
        name: e.name,
        isGroupEpreuve: !!e.is_group_epreuve,
        isPoleTest,
        pole: e.pole || null,
        poleKnown: !isPoleTest || eligibleMemberIds.length > 0,
        durationMinutes: e.duration_minutes ?? 30,
        roulementMinutes: e.roulement_minutes ?? 10,
        minEvaluatorsPerSalle: e.min_evaluators_per_salle ?? (e.is_group_epreuve ? 4 : 2),
        groupSize: e.group_size ?? null,
        minCandidates: e.min_candidates ?? null,
        dateDebut: e.date_debut ? String(e.date_debut).split("T")[0] : null,
        dateFin: e.date_fin ? String(e.date_fin).split("T")[0] : null,
        heureDebutJournee: e.heure_debut_journee ?? null,
        heureFinJournee: e.heure_fin_journee ?? null,
        expectedCandidates,
        existingSlots: existingByEpreuve.get(e.id) || 0,
        eligibleMemberIds,
      };
    });

    const hhmm = (v: string) => String(v).slice(0, 5);
    const ymd = (v: string) => String(v).split("T")[0];

    const busy = (assignsRes.data || [])
      .filter((a) => a.slot && !isCancelled(a.slot.status))
      .map((a) => ({
        memberId: a.member_id,
        date: ymd(a.slot!.date),
        startTime: hhmm(a.slot!.start_time),
        endTime: hhmm(a.slot!.end_time),
      }));

    const roomsTaken = (slotsRes.data || [])
      .filter((s) => s.room && !isCancelled(s.status))
      .map((s) => ({
        room: String(s.room).trim(),
        date: ymd(s.date),
        startTime: hhmm(s.start_time),
        endTime: hhmm(s.end_time),
      }));

    return Response.json({
      tour: tourNum,
      margePct,
      candidatsAttendus: tourCandidatsAttendus,
      rooms: roomList.rooms,
      knownPoles,
      members: members.map((m) => ({
        id: m.id,
        name: `${m.first_name || ""} ${m.last_name || ""}`.trim() || m.email,
        pole: m.pole || null,
      })),
      epreuves,
      busy,
      roomsTaken,
    });
  } catch (error) {
    console.error("GET tours/[tour]/generation-inputs error:", error);
    return Response.json(
      { error: "Échec du chargement des entrées de génération", details: (error as any)?.message || String(error) },
      { status: 500 },
    );
  }
}
