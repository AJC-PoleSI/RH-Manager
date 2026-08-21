import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { validatePassword } from "@/lib/password";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";

// POST /api/auth/change-password  { currentPassword, newPassword }
//
// Changement de mot de passe par le membre lui-même, en session. Le mot de
// passe actuel est exigé : un JWT volé ne doit pas suffire à verrouiller le
// compte de son propriétaire.
export async function POST(req: NextRequest) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (user.role !== "member") return forbidden();

  try {
    const { currentPassword, newPassword } = await req.json();

    if (!currentPassword || !newPassword) {
      return Response.json(
        { error: "Mot de passe actuel et nouveau mot de passe requis." },
        { status: 400 },
      );
    }

    const pwError = validatePassword(newPassword);
    if (pwError) return Response.json({ error: pwError }, { status: 400 });

    const { data: member, error } = await supabaseAdmin
      .from("members")
      .select("id, password_hash")
      .eq("id", user.id)
      .single();

    if (error || !member) {
      return Response.json({ error: "Compte introuvable." }, { status: 404 });
    }

    const valid = await bcrypt.compare(currentPassword, member.password_hash);
    if (!valid) {
      return Response.json(
        { error: "Mot de passe actuel incorrect." },
        { status: 400 },
      );
    }

    if (currentPassword === newPassword) {
      return Response.json(
        { error: "Le nouveau mot de passe doit être différent de l'actuel." },
        { status: 400 },
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from("members")
      .update({
        password_hash: await bcrypt.hash(newPassword, 10),
        must_change_password: false,
        password_changed_at: new Date().toISOString(),
        // Un changement en session invalide les liens de reset en circulation.
        password_reset_token: null,
        password_reset_expires_at: null,
      })
      .eq("id", user.id);

    if (updateError) throw updateError;

    return Response.json({ ok: true });
  } catch (error) {
    console.error("change-password error:", error);
    return Response.json(
      { error: "Erreur lors du changement de mot de passe." },
      { status: 500 },
    );
  }
}
