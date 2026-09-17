import { supabaseAdmin, isMissingTableError } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import {
  decodePhotoDataUrl,
  photoErrorMessage,
  MAX_PHOTO_BYTES,
} from "@/lib/candidate-photo";
import { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ id: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Cache mémoire des photos (par instance de fonction).
//
// EGRESS : chaque photo pèse 30-60 Ko en base. Avant ce cache, la route lisait
// la colonne `data` à CHAQUE requête — y compris pour répondre 304 — soit
// ~4 000 lectures par jour (17/09/2026), le premier poste d'egress Supabase
// du projet, qui a fait dépasser le quota du plan.
//
// Désormais on ne lit que `updated_at` (quelques octets) pour valider
// l'ETag ; la colonne `data` n'est lue qu'en cas de vraie absence en cache.
// La validité d'une entrée est portée par sa version (updated_at) : une photo
// remplacée depuis une autre instance est détectée à la lecture suivante.
// ---------------------------------------------------------------------------
interface CachedPhoto {
  version: number;
  mimeType: string;
  buffer: Buffer;
}

/** ~400 photos × 60 Ko max ≈ 25 Mo, très en deçà de la mémoire d'une fonction. */
const PHOTO_CACHE_MAX = 400;
const photoCache = new Map<string, CachedPhoto>();

function cachePut(candidateId: string, entry: CachedPhoto) {
  photoCache.delete(candidateId);
  if (photoCache.size >= PHOTO_CACHE_MAX) {
    // Map itère dans l'ordre d'insertion : la première clé est la plus ancienne.
    const oldest = photoCache.keys().next().value;
    if (oldest !== undefined) photoCache.delete(oldest);
  }
  photoCache.set(candidateId, entry);
}

function photoEtag(candidateId: string, version: number): string {
  return `"${candidateId}-${version}"`;
}

/**
 * GET /api/candidates/[id]/photo — sert la photo en binaire.
 *
 * SÉCURITÉ : la photo d'un candidat est une donnée personnelle. La route
 * exige un jeton (donc un `fetch` authentifié côté client, pas un `<img src>`
 * nu — cf. components/ui/CandidatePhoto.tsx) et n'est ouverte qu'aux membres
 * du staff et au candidat lui-même. Un candidat ne voit jamais la photo d'un
 * autre candidat.
 *
 * CACHE NAVIGATEUR : le client passe `?v=<version>` (lib/photo-cache.ts). Quand
 * cette version est la version courante, la réponse est déclarée immuable :
 * le navigateur ne redemande plus jamais cette URL, et une nouvelle photo
 * change d'URL via `photoUpdatedAt` dans les listes. Sans `v` (ou périmé),
 * on retombe sur une revalidation courte par ETag.
 */
export async function GET(req: NextRequest, context: RouteContext) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return Response.json({ error: "Identifiant invalide" }, { status: 400 });
  }

  if (payload.role === "candidate" && payload.id !== id) return forbidden();

  // 1. Version seule : quelques octets, jamais la colonne `data`.
  const { data: meta, error: metaError } = await supabaseAdmin
    .from("candidate_photos")
    .select("updated_at")
    .eq("candidate_id", id)
    .maybeSingle();

  if (metaError) {
    // Migration pas encore appliquée : personne n'a de photo, ce qui est
    // exactement un 404. Les vignettes retombent sur les initiales.
    if (isMissingTableError(metaError)) {
      return Response.json({ error: "Aucune photo" }, { status: 404 });
    }
    console.error("GET candidate photo error:", metaError);
    return Response.json({ error: "Photo indisponible" }, { status: 500 });
  }
  if (!meta) return Response.json({ error: "Aucune photo" }, { status: 404 });

  const version = new Date(meta.updated_at).getTime();
  const etag = photoEtag(id, version);

  const requestedVersion = new URL(req.url).searchParams.get("v");
  const immutable =
    requestedVersion !== null && requestedVersion === String(version);
  // `private` : cache navigateur uniquement, jamais un cache partagé —
  // la réponse dépend du porteur du jeton.
  const cacheControl = immutable
    ? "private, max-age=31536000, immutable"
    : "private, max-age=300, must-revalidate";

  // 2. Revalidation conditionnelle AVANT toute lecture du binaire.
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": cacheControl },
    });
  }

  // 3. Cache mémoire, validé par la version.
  let cached = photoCache.get(id);
  if (!cached || cached.version !== version) {
    const { data, error } = await supabaseAdmin
      .from("candidate_photos")
      .select("mime_type, data")
      .eq("candidate_id", id)
      .maybeSingle();

    if (error) {
      console.error("GET candidate photo error:", error);
      return Response.json({ error: "Photo indisponible" }, { status: 500 });
    }
    if (!data) return Response.json({ error: "Aucune photo" }, { status: 404 });

    let buffer: Buffer;
    try {
      buffer = Buffer.from(data.data, "base64");
    } catch {
      return Response.json({ error: "Photo illisible" }, { status: 500 });
    }

    cached = { version, mimeType: data.mime_type, buffer };
    cachePut(id, cached);
  }

  return new Response(new Uint8Array(cached.buffer), {
    status: 200,
    headers: {
      "Content-Type": cached.mimeType,
      "Content-Length": String(cached.buffer.byteLength),
      ETag: etag,
      "Cache-Control": cacheControl,
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * PUT /api/candidates/[id]/photo — dépose ou remplace la photo.
 *
 * Corps : `{ "dataUrl": "data:image/jpeg;base64,..." }`, l'image étant déjà
 * redimensionnée par le navigateur (cf. lib/photo-client.ts).
 *
 * SÉCURITÉ : le candidat ne peut agir que sur sa propre fiche. Côté staff,
 * seul un admin peut téléverser à la place d'un candidat (dépannage le jour
 * de l'épreuve) ; un examinateur non-admin n'a rien à écrire ici.
 */
export async function PUT(req: NextRequest, context: RouteContext) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return Response.json({ error: "Identifiant invalide" }, { status: 400 });
  }

  if (payload.role === "candidate") {
    if (payload.id !== id) return forbidden();
  } else if (!payload.isAdmin) {
    return forbidden();
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Requête invalide" }, { status: 400 });
  }

  const decoded = decodePhotoDataUrl(body?.dataUrl);
  if (!decoded.ok) {
    return Response.json(
      { error: photoErrorMessage(decoded.error) },
      { status: decoded.error === "too_large" ? 413 : 400 },
    );
  }

  // Le candidat doit exister : sans ce contrôle, la contrainte de clé
  // étrangère renverrait une 500 opaque sur un id inventé.
  const { data: candidate } = await supabaseAdmin
    .from("candidates")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (!candidate) {
    return Response.json({ error: "Candidat introuvable" }, { status: 404 });
  }

  const { error } = await supabaseAdmin.from("candidate_photos").upsert(
    {
      candidate_id: id,
      mime_type: decoded.photo.mimeType,
      data: decoded.photo.base64,
      byte_size: decoded.photo.byteSize,
      updated_at: new Date().toISOString(),
      updated_by: payload.role === "candidate" ? "candidate" : payload.id,
    },
    { onConflict: "candidate_id" },
  );

  if (error) {
    if (isMissingTableError(error)) {
      return Response.json(
        {
          error:
            "Les photos ne sont pas encore activées : la migration SQL (supabase-migration-photos-coups-de-coeur.sql) reste à appliquer dans Supabase.",
          migrationPending: true,
        },
        { status: 503 },
      );
    }
    console.error("Upsert candidate photo error:", error);
    return Response.json(
      { error: "Échec de l'enregistrement de la photo." },
      { status: 500 },
    );
  }

  photoCache.delete(id);

  return Response.json({
    ok: true,
    byteSize: decoded.photo.byteSize,
    maxBytes: MAX_PHOTO_BYTES,
    updatedAt: new Date().toISOString(),
  });
}

/** DELETE /api/candidates/[id]/photo — retire la photo (candidat lui-même ou admin). */
export async function DELETE(req: NextRequest, context: RouteContext) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return Response.json({ error: "Identifiant invalide" }, { status: 400 });
  }

  if (payload.role === "candidate") {
    if (payload.id !== id) return forbidden();
  } else if (!payload.isAdmin) {
    return forbidden();
  }

  const { error } = await supabaseAdmin
    .from("candidate_photos")
    .delete()
    .eq("candidate_id", id);

  if (error && !isMissingTableError(error)) {
    console.error("Delete candidate photo error:", error);
    return Response.json({ error: "Échec de la suppression." }, { status: 500 });
  }

  photoCache.delete(id);

  return Response.json({ ok: true });
}
