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

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/members/[id]
export async function GET(req: NextRequest, context: RouteContext) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  // SECURITY (audit #13): candidates have no business listing members.
  if (payload.role === "candidate") return forbidden();

  const { id } = await context.params;

  try {
    const readMember = (columns: string) =>
      supabaseAdmin.from("members").select(columns).eq("id", id).single();

    // `is_pole_lead` vient d'une migration manuelle (supabase-migration-
    // pole-lead.sql) : si la colonne manque encore, on relit la fiche sans
    // elle (isPoleLead = false) plutôt que de répondre 404.
    let { data, error } = await readMember(
      "id, email, is_admin, first_name, last_name, pole, is_pole_lead",
    );
    if (error && isMissingColumnError(error)) {
      ({ data, error } = await readMember(
        "id, email, is_admin, first_name, last_name, pole",
      ));
    }

    if (error || !data) {
      return Response.json({ error: "Member not found" }, { status: 404 });
    }

    const m: any = data;
    return Response.json({
      id: m.id,
      email: m.email,
      isAdmin: m.is_admin,
      firstName: m.first_name || "",
      lastName: m.last_name || "",
      pole: m.pole || "",
      isPoleLead: !!m.is_pole_lead,
    });
  } catch {
    return Response.json({ error: "Failed to fetch member" }, { status: 500 });
  }
}

// PUT /api/members/[id] (admin only)
export async function PUT(req: NextRequest, context: RouteContext) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  const { id } = await context.params;

  try {
    const body = await req.json();
    const { email, password, isAdmin, firstName, lastName, pole, isPoleLead } =
      body;

    // ══════════════════════════════════════════════════════════════════
    // SECURITY: An admin account must remain admin.
    // If the caller tries to set isAdmin=false on a current admin → 403.
    // Same protection model as DELETE (admins are immutable from below).
    // ══════════════════════════════════════════════════════════════════
    if (isAdmin === false) {
      const { data: targetMember } = await supabaseAdmin
        .from("members")
        .select("email")
        .eq("id", id)
        .single();
      if (isSuperAdminEmail(targetMember?.email)) {
        return Response.json(
          {
            error:
              "Impossible de retirer le rôle administrateur au compte super-administrateur",
          },
          { status: 403 },
        );
      }
    }

    const updateData: Record<string, unknown> = {};
    // SECURITY (audit SEC-008) : email toujours stocké en minuscules,
    // sinon le compte devient impossible à connecter (le login normalise).
    if (email !== undefined)
      updateData.email = String(email).trim().toLowerCase();
    if (isAdmin !== undefined) updateData.is_admin = isAdmin;
    if (firstName !== undefined) updateData.first_name = firstName;
    if (lastName !== undefined) updateData.last_name = lastName;
    if (pole !== undefined) updateData.pole = pole;
    if (isPoleLead !== undefined) updateData.is_pole_lead = !!isPoleLead;
    if (password) {
      updateData.password_hash = await bcrypt.hash(password, BCRYPT_COST);
    }

    const updateMember = (patch: Record<string, unknown>, columns: string) =>
      supabaseAdmin
        .from("members")
        .update(patch)
        .eq("id", id)
        .select(columns)
        .single();

    // Repli si `is_pole_lead` manque encore (migration manuelle) : on rejoue
    // la mise à jour sans cette clé pour ne pas bloquer l'édition du reste de
    // la fiche. La première tentative refusée n'a rien écrit.
    let { data, error } = await updateMember(
      updateData,
      "id, email, is_admin, first_name, last_name, pole, is_pole_lead",
    );
    if (error && isMissingColumnError(error)) {
      const withoutPoleLead = { ...updateData };
      delete withoutPoleLead.is_pole_lead;
      ({ data, error } = await updateMember(
        withoutPoleLead,
        "id, email, is_admin, first_name, last_name, pole",
      ));
    }

    if (error) {
      return Response.json(
        { error: "Failed to update member" },
        { status: 400 },
      );
    }

    const m: any = data;
    return Response.json({
      id: m.id,
      email: m.email,
      isAdmin: m.is_admin,
      firstName: m.first_name || "",
      lastName: m.last_name || "",
      pole: m.pole || "",
      isPoleLead: !!m.is_pole_lead,
    });
  } catch {
    return Response.json({ error: "Failed to update member" }, { status: 400 });
  }
}

// DELETE /api/members/[id] (admin only)
export async function DELETE(req: NextRequest, context: RouteContext) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  const { id } = await context.params;

  try {
    // SECURITY: seul le compte SUPER-ADMIN est protégé. Tous les autres
    // (y compris les admins classiques, qui sont aussi des membres)
    // peuvent être supprimés.
    const { data: memberToDelete } = await supabaseAdmin
      .from("members")
      .select("email")
      .eq("id", id)
      .single();

    if (isSuperAdminEmail(memberToDelete?.email)) {
      return Response.json(
        { error: "Impossible de supprimer le compte super-administrateur" },
        { status: 403 },
      );
    }

    const { error } = await supabaseAdmin.from("members").delete().eq("id", id);

    if (error) {
      return Response.json(
        { error: "Failed to delete member" },
        { status: 400 },
      );
    }

    return new Response(null, { status: 204 });
  } catch {
    return Response.json({ error: "Failed to delete member" }, { status: 400 });
  }
}
