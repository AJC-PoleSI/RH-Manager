import { supabaseAdmin, isMissingTableError } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import {
  MAX_FAVORITES,
  isEliminated,
  eliminatedAtTour,
  countActiveFavorites,
} from "@/lib/favorites";
import { NextRequest } from "next/server";

/**
 * GET /api/organigramme — le trombinoscope du jury.
 *
 * Renvoie tous les candidats avec, pour chacun : de quoi afficher sa vignette
 * (identité + présence d'une photo), son état d'élimination, et les coups de
 * cœur.
 *
 * SÉCURITÉ :
 *  • Réservé au staff : un candidat n'a pas à connaître les autres candidats.
 *  • Un membre non-admin ne reçoit QUE ses propres coups de cœur. Le décompte
 *    global et le nom des membres qui ont donné un cœur sont réservés à
 *    l'admin — c'est l'engagement pris auprès du jury : « visible par eux et
 *    les admins ».
 *  • Aucun champ hors identité n'est exposé (pas d'email, pas de formation,
 *    pas de notes) : cette page est un trombinoscope, pas une fiche.
 */
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (payload.role === "candidate") return forbidden();

  const isAdmin = !!payload.isAdmin;

  try {
    const [candidatesRes, photosRes, favoritesRes] = await Promise.all([
      supabaseAdmin
        .from("candidates")
        .select("id, first_name, last_name, deliberations(*), candidate_wishes(pole, rank)")
        // Même règle qu'en délibération : les inscriptions non confirmées ne
        // sont pas des candidats.
        .eq("email_verified", true)
        .order("last_name", { ascending: true }),
      supabaseAdmin.from("candidate_photos").select("candidate_id, updated_at"),
      // Un non-admin ne lit que ses propres lignes.
      isAdmin
        ? supabaseAdmin
            .from("candidate_favorites")
            .select(
              "candidate_id, member_id, created_at, members!member_id(first_name, last_name, email)",
            )
        : supabaseAdmin
            .from("candidate_favorites")
            .select("candidate_id, member_id, created_at")
            .eq("member_id", payload.id),
    ]);

    if (candidatesRes.error) throw candidatesRes.error;

    // Les migrations de ce dépôt sont posées à la main : tant que le SQL n'est
    // pas exécuté, on sert quand même le trombinoscope (identités + statuts) et
    // on le dit, plutôt que de rendre la page inutilisable.
    const migrationPending =
      isMissingTableError(photosRes.error) ||
      isMissingTableError(favoritesRes.error);

    if (photosRes.error && !isMissingTableError(photosRes.error)) {
      throw photosRes.error;
    }
    if (favoritesRes.error && !isMissingTableError(favoritesRes.error)) {
      throw favoritesRes.error;
    }

    const candidates = candidatesRes.data || [];
    const favorites = (favoritesRes.data || []) as any[];

    const photoByCandidate = new Map<string, string>();
    for (const p of photosRes.data || []) {
      photoByCandidate.set(p.candidate_id, p.updated_at);
    }

    // Élimination : calculée une fois, elle sert au tri, au grisé et au quota.
    const eliminatedIds = new Set<string>();
    for (const c of candidates) {
      const delib = Array.isArray(c.deliberations)
        ? c.deliberations[0]
        : c.deliberations;
      if (isEliminated(delib)) eliminatedIds.add(c.id);
    }

    const myFavoriteIds = new Set(
      favorites.filter((f) => f.member_id === payload.id).map((f) => f.candidate_id),
    );

    // Admin : qui a donné un cœur à qui.
    const favoritesByCandidate = new Map<string, { memberId: string; name: string }[]>();
    if (isAdmin) {
      for (const f of favorites) {
        const m = f.members;
        const name = m
          ? [m.first_name, m.last_name].filter(Boolean).join(" ").trim() || m.email
          : "Membre";
        const list = favoritesByCandidate.get(f.candidate_id) || [];
        list.push({ memberId: f.member_id, name });
        favoritesByCandidate.set(f.candidate_id, list);
      }
    }

    const result = candidates.map((c: any) => {
      const delib = Array.isArray(c.deliberations)
        ? c.deliberations[0] || null
        : c.deliberations;
      const eliminated = eliminatedIds.has(c.id);
      const wishes = (c.candidate_wishes || []) as any[];
      const firstWish =
        wishes.find((w) => w.rank === 1)?.pole || wishes[0]?.pole || null;

      const voters = favoritesByCandidate.get(c.id) || [];

      return {
        id: c.id,
        firstName: c.first_name,
        lastName: c.last_name,
        hasPhoto: photoByCandidate.has(c.id),
        photoUpdatedAt: photoByCandidate.get(c.id) || null,
        eliminated,
        eliminatedAtTour: eliminatedAtTour(delib),
        statuses: {
          tour1: delib?.tour1_status || "pending",
          tour2: delib?.tour2_status || "pending",
          tour3: delib?.tour3_status || "pending",
        },
        firstWish,
        /** Ce membre-ci a-t-il donné son cœur ? */
        isFavorite: myFavoriteIds.has(c.id),
        /** Admin uniquement — sinon 0 / liste vide. */
        favoritesCount: isAdmin ? voters.length : 0,
        favoritedBy: isAdmin ? voters.map((v) => v.name).sort() : [],
      };
    });

    // Les éliminés tombent en bas de la liste, chaque groupe restant trié par
    // nom (l'ordre alphabétique vient déjà de la requête).
    result.sort((a, b) => Number(a.eliminated) - Number(b.eliminated));

    const usedFavorites = countActiveFavorites(
      Array.from(myFavoriteIds),
      eliminatedIds,
    );

    return Response.json({
      candidates: result,
      favorites: {
        max: MAX_FAVORITES,
        used: usedFavorites,
        remaining: Math.max(0, MAX_FAVORITES - usedFavorites),
        /** Cœurs conservés sur des candidats éliminés : ils ne coûtent rien. */
        onEliminated: myFavoriteIds.size - usedFavorites,
      },
      isAdmin,
      /**
       * `true` = supabase-migration-photos-coups-de-coeur.sql n'a pas encore
       * été exécuté. Photos et cœurs sont alors inertes.
       */
      migrationPending,
    });
  } catch (error) {
    console.error("GET /api/organigramme error:", error);
    return Response.json(
      { error: "Échec du chargement de l'organigramme" },
      { status: 500 },
    );
  }
}
