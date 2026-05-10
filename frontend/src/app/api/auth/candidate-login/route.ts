import { supabaseAdmin } from "@/lib/supabase";
import { signToken } from "@/lib/auth";
import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { email, dateOfBirth } = await req.json();

    if (!email || !dateOfBirth) {
      return Response.json(
        { error: "Email et date de naissance requis." },
        { status: 400 },
      );
    }

    const { data: candidate, error } = await supabaseAdmin
      .from("candidates")
      .select("id, first_name, last_name, email, phone, date_of_birth")
      .eq("email", email)
      .single();

    if (error || !candidate) {
      return Response.json(
        { error: "Candidat introuvable. Vérifiez votre email." },
        { status: 401 },
      );
    }

    // Compare dates (ignore time)
    const dbDate = candidate.date_of_birth;
    if (!dbDate || dbDate !== dateOfBirth) {
      return Response.json(
        { error: "Date de naissance incorrecte." },
        { status: 401 },
      );
    }

    const token = signToken({
      id: candidate.id,
      email: candidate.email,
      role: "candidate",
    });

    return Response.json({ token, candidate });
  } catch (error) {
    console.error("Candidate login error:", error);
    return Response.json(
      { error: "Erreur de connexion candidat." },
      { status: 500 },
    );
  }
}
