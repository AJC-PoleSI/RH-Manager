import { supabaseAdmin } from "@/lib/supabase";
import {
  getTokenFromRequest,
  unauthorized,
  forbidden,
  isSuperAdminEmail,
} from "@/lib/auth";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { BCRYPT_COST } from "@/lib/password";
import { isMissingColumnError } from "@/lib/slot-lock";

// GET /api/members
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  // ── Candidats : pas d'accès à la liste des membres ──
  if (payload.role === "candidate") {
    return Response.json({ error: "Acces interdit" }, { status: 403 });
  }

  try {
    // Admin : accès complet avec password hash
    // Membre : infos basiques sans mot de passe
    const selectFields = payload.isAdmin
      ? "id, email, password_hash, is_admin, first_name, last_name, pole"
      : "id, email, is_admin, first_name, last_name, pole";
    const readMembers = (columns: string) =>
      supabaseAdmin.from("members").select(columns);

    // `is_pole_lead` vient d'une migration manuelle (supabase-migration-
    // pole-lead.sql) : tant que Felix ne l'a pas appliquée, la colonne manque
    // et la lecture échouerait. On relit alors sans elle (isPoleLead = false)
    // plutôt que de vider la liste des membres.
    let { data, error } = await readMembers(`${selectFields}, is_pole_lead`);
    if (error && isMissingColumnError(error)) {
      ({ data, error } = await readMembers(selectFields));
    }

    if (error) {
      return Response.json(
        { error: "Failed to fetch members" },
        { status: 500 },
      );
    }

    const mapped = (data || []).map((m: any) => ({
      id: m.id,
      email: m.email,
      password: payload.isAdmin ? (m.password_hash ? "••••••" : "") : undefined,
      isAdmin: m.is_admin,
      isSuperAdmin: isSuperAdminEmail(m.email),
      firstName: m.first_name || "",
      lastName: m.last_name || "",
      pole: m.pole || "",
      isPoleLead: !!m.is_pole_lead,
    }));

    return Response.json(mapped);
  } catch {
    return Response.json({ error: "Failed to fetch members" }, { status: 500 });
  }
}

// POST /api/members (admin only)
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const body = await req.json();
    const { email, password, isAdmin, firstName, lastName, pole, isPoleLead } =
      body;

    if (!email || !password) {
      return Response.json(
        { error: "Email and password are required" },
        { status: 400 },
      );
    }

    // SECURITY (audit SEC-008) : le login compare des emails en minuscules.
    // Sans cette normalisation, un compte créé en casse mixte est
    // introuvable à la connexion → « Invalid credentials » à vie.
    const emailNorm = String(email).trim().toLowerCase();

    const { data: existing } = await supabaseAdmin
      .from("members")
      .select("id")
      .eq("email", emailNorm)
      .maybeSingle();

    if (existing) {
      return Response.json({ error: "Email already exists" }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

    const newMember = {
      email: emailNorm,
      password_hash: passwordHash,
      is_admin: isAdmin || false,
      first_name: firstName || null,
      last_name: lastName || null,
      pole: pole || null,
    };
    const insertMember = (row: Record<string, unknown>, columns: string) =>
      supabaseAdmin.from("members").insert(row).select(columns).single();

    // Même repli qu'en lecture : `is_pole_lead` manque tant que la migration
    // n'est pas appliquée. L'insertion refusée n'a rien écrit (PostgREST
    // rejette avant d'écrire), on la rejoue sans le champ : le compte est
    // créé, la case sera simplement à recocher après la migration.
    let { data, error } = await insertMember(
      { ...newMember, is_pole_lead: !!isPoleLead },
      "id, email, is_admin, first_name, last_name, pole, is_pole_lead",
    );
    if (error && isMissingColumnError(error)) {
      ({ data, error } = await insertMember(
        newMember,
        "id, email, is_admin, first_name, last_name, pole",
      ));
    }

    if (error) {
      return Response.json(
        { error: "Failed to create member" },
        { status: 400 },
      );
    }

    const created: any = data;
    return Response.json(
      {
        id: created.id,
        email: created.email,
        isAdmin: created.is_admin,
        firstName: created.first_name || "",
        lastName: created.last_name || "",
        pole: created.pole || "",
        isPoleLead: !!created.is_pole_lead,
      },
      { status: 201 },
    );
  } catch {
    return Response.json({ error: "Failed to create member" }, { status: 400 });
  }
}
