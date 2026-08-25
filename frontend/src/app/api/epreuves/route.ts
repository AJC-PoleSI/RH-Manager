import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { getCandidateWishedPoles } from "@/lib/admission";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
// GET /api/epreuves
// SECURITY: requiert une session (la config des épreuves n'est pas publique).
// TOUR 3 : un candidat ne voit pas les épreuves de pôle des pôles qu'il n'a
// pas demandés dans ses vœux.
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  try {
    const { data, error } = await supabaseAdmin
      .from("epreuves")
      .select("*")
      .order("tour", { ascending: true });

    if (error) throw error;

    const parsed = (data || []).map((e: any) => ({
      id: e.id,
      name: e.name,
      tour: e.tour,
      tourName: `Tour ${e.tour}`,
      type: e.type,
      durationMinutes: e.duration_minutes,
      evaluationQuestions:
        typeof e.evaluation_questions === "string"
          ? (() => {
              try {
                return JSON.parse(e.evaluation_questions);
              } catch {
                return [];
              }
            })()
          : (e.evaluation_questions ?? []),
      roulementMinutes: e.roulement_minutes ?? 10,
      minEvaluatorsPerSalle: e.min_evaluators_per_salle ?? 2,
      isPoleTest: e.is_pole_test ?? false,
      pole: e.pole || null,
      isGroupEpreuve: e.is_group_epreuve ?? false,
      groupSize: e.group_size ?? 1,
      isCommune: e.type === "commune",
      description: e.description || null,
      dateDebut: e.date_debut ? e.date_debut.split("T")[0] : null,
      dateFin: e.date_fin ? e.date_fin.split("T")[0] : null,
      heureDebut: e.heure_debut ?? null,
      salle: e.salle ?? null,
      presentedBy: e.presented_by ?? null,
      inscriptionDeadline: e.inscription_deadline ?? null,
      color: e.color || "#3B82F6",
      isVisible: true, // TODO: add is_visible to Supabase schema
    }));

    let result = parsed;
    if (payload.role === "candidate") {
      const wishedPoles = await getCandidateWishedPoles(payload.id);
      result = parsed.filter(
        (e: any) => !e.isPoleTest || !e.pole || wishedPoles.includes(e.pole),
      );
    } else if (payload.role === "member" && !payload.isAdmin) {
      // PÔLE : un membre non-admin ne voit les épreuves de pôle que de
      // SON pôle (il ne doit pas pouvoir s'inscrire comme examinateur
      // sur les épreuves des autres pôles). Admin voit tout.
      const { data: me } = await supabaseAdmin
        .from("members")
        .select("pole")
        .eq("id", payload.id)
        .maybeSingle();
      result = parsed.filter(
        (e: any) =>
          !e.isPoleTest || !e.pole || (me?.pole && e.pole === me.pole),
      );
    }

    return Response.json(result);
  } catch (error) {
    console.error("GET /epreuves error:", error);
    return Response.json(
      { error: "Failed to fetch epreuves" },
      { status: 500 },
    );
  }
}

// POST /api/epreuves
// Barème par défaut d'un critère quand aucun n'est fourni — aligné sur le
// repli utilisé par la grille de notation et par la validation des scores
// (`q.weight || q.maxScore || q.coefficient || 20`).
const DEFAULT_MAX_POINTS = 20;

// `weight` porte le nombre de points MAXIMUM d'un critère. Un client qui
// envoie 0, une valeur négative ou rien du tout rendrait l'épreuve
// impossible à noter (toute note serait « supérieure au barème »), donc on
// retombe sur le barème par défaut.
function normalizeQuestions(raw: unknown): unknown[] {
  let questions: unknown = raw;
  if (typeof questions === "string") {
    try {
      questions = JSON.parse(questions);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(questions)) return [];

  return questions.map((q: any) => {
    if (!q || typeof q !== "object") return q;
    const declared = Number(q.weight ?? q.maxScore ?? q.coefficient);
    return {
      ...q,
      weight: Number.isFinite(declared) && declared > 0 ? declared : DEFAULT_MAX_POINTS,
    };
  });
}

export async function POST(req: NextRequest) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (!user.isAdmin) return forbidden();

  try {
    const body = await req.json();

    const insertData: any = {
      name: body.name,
      tour: body.tour ?? 1,
      type: body.type ?? "commune",
      duration_minutes: Number(body.durationMinutes) || 30,
      evaluation_questions:
        typeof body.evaluationQuestions === "string"
          ? body.evaluationQuestions
          : JSON.stringify(body.evaluationQuestions ?? []),
      is_pole_test: Boolean(body.isPoleTest),
      pole: body.pole || null,
      // Épreuves de groupe : le flag + la capacité max de candidats par
      // créneau (repris par bulk-create/generate comme max_candidates).
      is_group_epreuve:
        body.isGroupEpreuve !== undefined
          ? Boolean(body.isGroupEpreuve)
          : body.type === "groupe",
      group_size: Math.max(1, Number(body.groupSize) || 1),
      roulement_minutes: Number(body.roulementMinutes) || 10,
      min_evaluators_per_salle: Number(body.minEvaluatorsPerSalle) || 2,
      date_debut: body.dateDebut
        ? new Date(body.dateDebut).toISOString()
        : null,
      date_fin: body.dateFin ? new Date(body.dateFin).toISOString() : null,
      // Only include inscription_deadline if the column exists (migration applied) and a value is set
      ...(body.inscriptionDeadline
        ? { inscription_deadline: new Date(body.inscriptionDeadline).toISOString() }
        : {}),
      // Épreuves sur table (commune) : heure de convocation, salle et
      // présentateur. Colonnes ajoutées par migration — on ne les inclut
      // que si fournies pour ne pas casser avant application.
      ...(body.heureDebut !== undefined
        ? { heure_debut: body.heureDebut || null }
        : {}),
      ...(body.salle !== undefined ? { salle: body.salle || null } : {}),
      ...(body.presentedBy !== undefined
        ? { presented_by: body.presentedBy || null }
        : {}),
      description: body.description || null,
      color: body.color || "#3B82F6",
      // is_visible: body.isVisible !== undefined ? body.isVisible : true, // TODO: add to Supabase schema
    };

    const { data, error } = await supabaseAdmin
      .from("epreuves")
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error("Supabase INSERT error:", error);
      return Response.json(
        { error: error.message || "Failed to create epreuve", details: error },
        { status: 400 },
      );
    }

    return Response.json(data, { status: 201 });
  } catch (error) {
    console.error("POST /epreuves catch error:", error);
    return Response.json(
      { error: String(error), message: "Failed to create epreuve" },
      { status: 400 },
    );
  }
}
