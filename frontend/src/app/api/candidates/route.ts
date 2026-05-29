import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { NextRequest } from "next/server";

// GET /api/candidates?search=&limit=&page=
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  // ── Permission : candidats ne peuvent pas voir la liste ──
  if (payload.role === "candidate") {
    return Response.json(
      { error: "Acces interdit aux candidats" },
      { status: 403 },
    );
  }

  const { searchParams } = req.nextUrl;
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "50");
  const search = searchParams.get("search") || "";
  const offset = (page - 1) * limit;

  try {
    // ── Tous les membres (admin ou non) voient tous les candidats ──
    // La restriction se fait au niveau de l'évaluation (seuls les membres assignés peuvent évaluer)
    let query = supabaseAdmin
      .from("candidates")
      .select("*, candidate_evaluations(*, members!member_id(email))", { count: "exact" })
      .range(offset, offset + limit - 1);

    if (search) {
      // SECURITY (audit SEC-004): `search` est injecté dans un filtre
      // PostgREST `.or()`. On retire les caractères de contrôle PostgREST
      // (virgule, parenthèses, étoile, %) pour empêcher l'injection de
      // filtres arbitraires / l'exfiltration de données.
      const safeSearch = search.replace(/[(),*%]/g, "").trim();
      if (safeSearch) {
        query = query.or(
          `first_name.ilike.%${safeSearch}%,last_name.ilike.%${safeSearch}%,email.ilike.%${safeSearch}%`,
        );
      }
    }

    const { data, error, count } = await query;

    if (error) {
      return Response.json(
        { error: "Failed to fetch candidates" },
        { status: 500 },
      );
    }

    const total = count ?? 0;

    // Map snake_case to camelCase for frontend
    const mapped = (data || []).map((c: any) => ({
      ...c,
      firstName: c.first_name,
      lastName: c.last_name,
      createdAt: c.created_at,
    }));

    return Response.json({
      data: mapped,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch {
    return Response.json(
      { error: "Failed to fetch candidates" },
      { status: 500 },
    );
  }
}

// POST /api/candidates
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  // SECURITY (audit #2): only admins can create candidates from this
  // endpoint. Candidates self-register via /api/auth/register-candidate.
  if (payload.role === "candidate" || !payload.isAdmin) {
    return Response.json({ error: "Accès interdit" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { firstName, lastName, email, phone, dateOfBirth } = body;

    if (!firstName || !lastName || !email) {
      return Response.json(
        { error: "Les champs Prénom, Nom et Email sont obligatoires." },
        { status: 400 },
      );
    }

    // Check for duplicate email
    const { data: existing } = await supabaseAdmin
      .from("candidates")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existing) {
      return Response.json(
        { error: "Un candidat avec cet email existe déjà." },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseAdmin
      .from("candidates")
      .insert({
        first_name: firstName,
        last_name: lastName,
        email,
        phone: phone || null,
        date_of_birth: dateOfBirth || null,
      })
      .select()
      .single();

    if (error) {
      // SECURITY (audit SEC-007): ne pas divulguer le détail interne au client.
      console.error("Create candidate error:", error);
      return Response.json(
        { error: "Échec de la création du candidat." },
        { status: 400 },
      );
    }

    return Response.json(data, { status: 201 });
  } catch {
    return Response.json(
      { error: "Échec de la création du candidat." },
      { status: 400 },
    );
  }
}
