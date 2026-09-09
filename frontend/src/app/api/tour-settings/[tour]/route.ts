import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/** Vrai si l'erreur signifie « la table tour_settings n'existe pas ». */
function isMissingTable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown };
  return (
    String(e.code ?? "") === "42P01" ||
    String(e.message ?? "").toLowerCase().includes("tour_settings")
  );
}

// GET /api/tour-settings/[tour] — effectif de candidats attendus pour ce
// tour (le NUMÉRO — epreuves.tour, un entier — pas l'UUID de la table
// `tours` gérée par /api/tours). Partagé par toutes les épreuves du tour :
// l'Entretien individuel et le Business Game du Tour 1 ont le même effectif,
// ce sont les mêmes candidats.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tour: string }> },
) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const { tour } = await params;
  const tourNum = Number(tour);
  if (!Number.isInteger(tourNum)) {
    return Response.json({ error: "Tour invalide" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("tour_settings")
    .select("*")
    .eq("tour", tourNum)
    .maybeSingle();

  if (error && !isMissingTable(error)) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({
    tour: tourNum,
    candidatsAttendus: data?.candidats_attendus ?? null,
    margePct: data?.marge_pct ?? 25,
  });
}

// PUT /api/tour-settings/[tour] — admin uniquement.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ tour: string }> },
) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  const { tour } = await params;
  const tourNum = Number(tour);
  if (!Number.isInteger(tourNum)) {
    return Response.json({ error: "Tour invalide" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const row = {
    tour: tourNum,
    candidats_attendus: body.candidatsAttendus
      ? Number(body.candidatsAttendus)
      : null,
    marge_pct: Number.isFinite(Number(body.margePct))
      ? Number(body.margePct)
      : 25,
  };

  const { error } = await supabaseAdmin
    .from("tour_settings")
    .upsert(row, { onConflict: "tour" });

  if (error) {
    if (isMissingTable(error)) {
      return Response.json(
        {
          error:
            "Table tour_settings absente — appliquez supabase-migration-tour-settings.sql.",
        },
        { status: 409 },
      );
    }
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({
    tour: tourNum,
    candidatsAttendus: row.candidats_attendus,
    margePct: row.marge_pct,
  });
}
