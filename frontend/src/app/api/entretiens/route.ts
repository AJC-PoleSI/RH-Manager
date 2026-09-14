import { supabaseAdmin } from "@/lib/supabase";
import {
  getTokenFromRequest,
  unauthorized,
  forbidden,
  samePole,
  POLE_LISTE_ENTRETIENS,
} from "@/lib/auth";
import { filterActiveEnrollments } from "@/lib/enrollment";
import { dayRangeUTC } from "@/lib/slot-conflicts";
import { fetchAllRows } from "@/lib/supabase-paging";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/entretiens?date=YYYY-MM-DD
//
// Liste à plat des entretiens d'UNE journée (heure, candidat, salle, jury),
// pour l'écran « Liste ». Renvoie aussi les jours qui portent
// au moins un créneau, pour que la page propose directement les bonnes dates.
//
// Nommée "entretiens" et non "slots" : les bloqueurs de pub (EasyList et
// dérivés) coupent silencieusement toute requête dont le chemin contient
// "/slots" — la requête n'atteint jamais le serveur, sans la moindre erreur
// visible (cf. /api/kpis/creneaux, même contournement).
//
// SECURITY : admins + membres du pôle Marketing (ce sont eux qui diffusent
// la liste). La réponse contient l'identité des candidats ET la composition
// des jurys de la journée. Le pôle est relu en base : les jetons émis avant
// cette fonctionnalité ne le portent pas, et une affiliation peut changer
// après la connexion.
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) {
    if (payload.role !== "member") return forbidden();
    const { data: membre, error: membreError } = await supabaseAdmin
      .from("members")
      .select("pole")
      .eq("id", payload.id)
      .maybeSingle();
    if (membreError) {
      console.error("Lecture du pôle impossible:", membreError);
      return forbidden();
    }
    if (!samePole(membre?.pole, POLE_LISTE_ENTRETIENS)) {
      return forbidden();
    }
  }

  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json(
      { error: "Paramètre `date` attendu au format YYYY-MM-DD" },
      { status: 400 },
    );
  }

  try {
    const { start, end } = dayRangeUTC(date);

    // Lecture PAGINÉE : la prod dépasse 1000 créneaux et PostgREST tronque
    // toute lecture non paginée à 1000 lignes, sans erreur.
    const { data, error } = await fetchAllRows<any>((from, to) =>
      supabaseAdmin
        .from("evaluation_slots")
        .select(
          `id, date, start_time, end_time, room, status, tour,
           epreuve:epreuves(id, name, tour),
           members:slot_member_assignments(member:members(id, first_name, last_name)),
           enrollments:slot_enrollments(status, candidate:candidates(id, first_name, last_name))`,
        )
        .gte("date", start)
        .lte("date", end)
        .order("start_time", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    );
    if (error) throw error;

    const personne = (p: any) => ({
      firstName: p?.first_name || "",
      lastName: p?.last_name || "",
    });

    const entretiens = (data || []).map((s: any) => ({
      id: s.id,
      startTime: String(s.start_time || "").substring(0, 5),
      endTime: String(s.end_time || "").substring(0, 5),
      room: s.room || "",
      epreuve: s.epreuve?.name || "",
      tour: s.epreuve?.tour ?? s.tour ?? null,
      status: s.status || "",
      // Une inscription annulée n'est pas un entretien : elle ne doit jamais
      // apparaître dans une liste qu'on colle à toute une promo.
      candidats: (s.enrollments || [])
        .filter(filterActiveEnrollments)
        .map((e: any) => personne(e.candidate))
        .filter((c: any) => c.firstName || c.lastName),
      examinateurs: (s.members || [])
        .map((m: any) => personne(m.member))
        .filter((m: any) => m.firstName || m.lastName),
    }));

    // Jours porteurs de créneaux, pour le sélecteur de dates de la page.
    // On ne lit que la colonne `date` : quelques milliers de lignes au pire.
    const { data: jours, error: joursError } = await fetchAllRows<any>(
      (from, to) =>
        supabaseAdmin
          .from("evaluation_slots")
          .select("date")
          .order("date", { ascending: true })
          .range(from, to),
    );
    if (joursError) throw joursError;

    // `date` est un TIMESTAMPTZ stocké à midi heure locale : la conversion en
    // jour calendaire doit se faire dans le fuseau de l'appli, pas en UTC.
    const datesDisponibles = Array.from(
      new Set(
        (jours || [])
          .map((j: any) =>
            j?.date
              ? new Date(j.date).toLocaleDateString("fr-CA", {
                  timeZone: "Europe/Paris",
                })
              : "",
          )
          .filter(Boolean),
      ),
    ).sort();

    return new Response(
      JSON.stringify({ date, entretiens, datesDisponibles }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      },
    );
  } catch (error) {
    console.error("GET /api/entretiens", error);
    return Response.json(
      { error: "Impossible de charger les entretiens" },
      { status: 500 },
    );
  }
}
