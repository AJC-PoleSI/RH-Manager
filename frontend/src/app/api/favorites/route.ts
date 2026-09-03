import { supabaseAdmin, isMissingTableError } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import {
  MAX_FAVORITES,
  isEliminated,
  countActiveFavorites,
} from "@/lib/favorites";
import { NextRequest } from "next/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cœurs du membre + quota restant.
 *
 * Le quota ignore les cœurs posés sur des candidats éliminés : ils restent en
 * base (savoir qui avait flashé sur qui a de la valeur en délibération) mais
 * sont rendus au membre.
 */
async function loadQuota(memberId: string) {
  const { data: rows, error } = await supabaseAdmin
    .from("candidate_favorites")
    .select("candidate_id")
    .eq("member_id", memberId);

  if (error) throw error;

  const ids = (rows || []).map((r) => r.candidate_id);
  if (ids.length === 0) {
    return { ids, eliminatedIds: new Set<string>(), used: 0 };
  }

  const { data: delibs, error: delibError } = await supabaseAdmin
    .from("deliberations")
    .select("candidate_id, tour1_status, tour2_status, tour3_status")
    .in("candidate_id", ids);

  if (delibError) throw delibError;

  const eliminatedIds = new Set<string>();
  for (const d of delibs || []) {
    if (isEliminated(d)) eliminatedIds.add(d.candidate_id);
  }

  return { ids, eliminatedIds, used: countActiveFavorites(ids, eliminatedIds) };
}

function quotaPayload(used: number, totalHearts: number) {
  return {
    max: MAX_FAVORITES,
    used,
    remaining: Math.max(0, MAX_FAVORITES - used),
    onEliminated: totalHearts - used,
  };
}

/**
 * La table n'existe pas : le SQL est à passer à la main dans Supabase. On le
 * dit au staff plutôt que de renvoyer une 500 muette.
 */
function migrationPendingResponse() {
  return Response.json(
    {
      error:
        "Les coups de cœur ne sont pas encore activés : la migration SQL (supabase-migration-photos-coups-de-coeur.sql) reste à appliquer dans Supabase.",
      migrationPending: true,
    },
    { status: 503 },
  );
}

/** GET /api/favorites — les coups de cœur du membre connecté et son quota. */
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (payload.role === "candidate") return forbidden();

  try {
    const { ids, used } = await loadQuota(payload.id);
    return Response.json({
      candidateIds: ids,
      favorites: quotaPayload(used, ids.length),
    });
  } catch (error) {
    if (isMissingTableError(error)) return migrationPendingResponse();
    console.error("GET /api/favorites error:", error);
    return Response.json(
      { error: "Échec du chargement des coups de cœur" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/favorites — pose ou retire un cœur.
 * Corps : `{ candidateId: string, favorite: boolean }`.
 *
 * SÉCURITÉ : un membre n'écrit que ses propres cœurs — `member_id` vient du
 * jeton, jamais du corps de la requête. Un admin ne peut pas voter à la place
 * d'un autre membre.
 */
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (payload.role === "candidate") return forbidden();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Requête invalide" }, { status: 400 });
  }

  const candidateId = body?.candidateId;
  const favorite = body?.favorite !== false; // défaut : on ajoute

  if (typeof candidateId !== "string" || !UUID_RE.test(candidateId)) {
    return Response.json({ error: "Candidat invalide" }, { status: 400 });
  }

  try {
    if (!favorite) {
      const { error } = await supabaseAdmin
        .from("candidate_favorites")
        .delete()
        .eq("member_id", payload.id)
        .eq("candidate_id", candidateId);

      if (error) throw error;

      const { ids, used } = await loadQuota(payload.id);
      return Response.json({
        isFavorite: false,
        favorites: quotaPayload(used, ids.length),
      });
    }

    // La délibération de la CIBLE est lue ici, et pas déduite de `loadQuota` :
    // celui-ci ne connaît que les candidats déjà aimés par le membre. Sans
    // cette lecture, un cœur posé sur un éliminé qui n'était pas encore dans
    // ses favoris était compté comme payant — donc refusé à quota plein.
    const { data: candidate } = await supabaseAdmin
      .from("candidates")
      .select("id, deliberations(tour1_status, tour2_status, tour3_status)")
      .eq("id", candidateId)
      .maybeSingle();

    if (!candidate) {
      return Response.json({ error: "Candidat introuvable" }, { status: 404 });
    }

    const targetDelib = Array.isArray((candidate as any).deliberations)
      ? (candidate as any).deliberations[0] || null
      : (candidate as any).deliberations || null;

    const { ids, used } = await loadQuota(payload.id);

    // Déjà coché : idempotent, on ne consomme pas un second cœur.
    if (ids.includes(candidateId)) {
      return Response.json({
        isFavorite: true,
        favorites: quotaPayload(used, ids.length),
      });
    }

    // Un cœur sur un candidat déjà éliminé ne coûte rien — sinon le quota
    // bloquerait pour un vote sans effet sur la suite du recrutement.
    const costsAHeart = !isEliminated(targetDelib);
    if (costsAHeart && used >= MAX_FAVORITES) {
      return Response.json(
        {
          error: `Vous avez déjà utilisé vos ${MAX_FAVORITES} coups de cœur. Retirez-en un pour en donner un autre.`,
          favorites: quotaPayload(used, ids.length),
        },
        { status: 409 },
      );
    }

    const { error } = await supabaseAdmin.from("candidate_favorites").insert({
      member_id: payload.id,
      candidate_id: candidateId,
    });

    // 23505 = doublon sur (member_id, candidate_id) : deux clics simultanés.
    // Le cœur existe, l'intention est satisfaite.
    if (error && (error as any).code !== "23505") throw error;

    const after = await loadQuota(payload.id);
    return Response.json({
      isFavorite: true,
      favorites: quotaPayload(after.used, after.ids.length),
    });
  } catch (error) {
    if (isMissingTableError(error)) return migrationPendingResponse();
    console.error("POST /api/favorites error:", error);
    return Response.json(
      { error: "Échec de l'enregistrement du coup de cœur" },
      { status: 500 },
    );
  }
}
