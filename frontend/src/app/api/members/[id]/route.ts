import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/members/[id]
export async function GET(req: NextRequest, context: RouteContext) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const { id } = await context.params;

  try {
    const { data, error } = await supabaseAdmin
      .from("members")
      .select("id, email, is_admin, first_name, last_name, pole")
      .eq("id", id)
      .single();

    if (error || !data) {
      return Response.json({ error: "Member not found" }, { status: 404 });
    }

    return Response.json({
      id: data.id,
      email: data.email,
      isAdmin: data.is_admin,
      firstName: data.first_name || "",
      lastName: data.last_name || "",
      pole: data.pole || "",
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
    const { email, password, isAdmin, firstName, lastName, pole } = body;

    // ══════════════════════════════════════════════════════════════════
    // SECURITY: An admin account must remain admin.
    // If the caller tries to set isAdmin=false on a current admin → 403.
    // Same protection model as DELETE (admins are immutable from below).
    // ══════════════════════════════════════════════════════════════════
    if (isAdmin === false) {
      const { data: targetMember } = await supabaseAdmin
        .from("members")
        .select("is_admin")
        .eq("id", id)
        .single();
      if (targetMember?.is_admin) {
        return Response.json(
          {
            error:
              "Impossible de retirer le rôle administrateur à un compte admin",
          },
          { status: 403 },
        );
      }
    }

    const updateData: Record<string, unknown> = {};
    if (email !== undefined) updateData.email = email;
    if (isAdmin !== undefined) updateData.is_admin = isAdmin;
    if (firstName !== undefined) updateData.first_name = firstName;
    if (lastName !== undefined) updateData.last_name = lastName;
    if (pole !== undefined) updateData.pole = pole;
    if (password) {
      updateData.password_hash = await bcrypt.hash(password, 10);
    }

    const { data, error } = await supabaseAdmin
      .from("members")
      .update(updateData)
      .eq("id", id)
      .select("id, email, is_admin, first_name, last_name, pole")
      .single();

    if (error) {
      return Response.json(
        { error: "Failed to update member" },
        { status: 400 },
      );
    }

    return Response.json({
      id: data.id,
      email: data.email,
      isAdmin: data.is_admin,
      firstName: data.first_name || "",
      lastName: data.last_name || "",
      pole: data.pole || "",
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
    // SECURITY: Prevent deleting admins
    const { data: memberToDelete } = await supabaseAdmin
      .from("members")
      .select("is_admin")
      .eq("id", id)
      .single();

    if (memberToDelete?.is_admin) {
      return Response.json(
        { error: "Cannot delete an administrator account" },
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
