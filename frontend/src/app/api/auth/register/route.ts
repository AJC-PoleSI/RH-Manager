import { supabaseAdmin } from "@/lib/supabase";
import {
  signToken,
  getTokenFromRequest,
  unauthorized,
  forbidden,
} from "@/lib/auth";
import { validatePassword } from "@/lib/password";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  // SECURITY: Only authenticated admins can create new members
  const caller = getTokenFromRequest(req);
  if (!caller) return unauthorized();
  if (!caller.isAdmin) return forbidden();

  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return Response.json(
        { error: "Email and password are required." },
        { status: 400 },
      );
    }

    const pwError = validatePassword(password);
    if (pwError) return Response.json({ error: pwError }, { status: 400 });

    const hashedPassword = await bcrypt.hash(password, 12);

    const { data: member, error } = await supabaseAdmin
      .from("members")
      .insert({
        // SECURITY (audit SEC-008) : le login compare en minuscules.
        email: String(email).trim().toLowerCase(),
        password_hash: hashedPassword,
        is_admin: false, // SECURITY: always false — admin promotion via separate flow
      })
      .select("id, email, is_admin")
      .single();

    if (error) {
      if (error.code === "23505") {
        return Response.json(
          { error: "Un membre avec cet email existe deja." },
          { status: 400 },
        );
      }
      return Response.json(
        { error: "Erreur lors de la creation du membre." },
        { status: 400 },
      );
    }

    return Response.json(
      {
        message: "Member created successfully",
        member: { id: member.id, email: member.email },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Register error:", error);
    return Response.json(
      { error: "Erreur lors de la creation du membre." },
      { status: 400 },
    );
  }
}
