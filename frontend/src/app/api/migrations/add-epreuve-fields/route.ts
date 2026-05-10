import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { NextRequest } from "next/server";

// POST /api/migrations/add-epreuve-fields — Ajouter description + documents_urls
export async function POST(req: NextRequest) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (!user.isAdmin) return forbidden();

  const results: string[] = [];

  try {
    // Try adding description column
    const { error: err1 } = await supabaseAdmin.rpc("exec_sql", {
      sql: `ALTER TABLE epreuves ADD COLUMN IF NOT EXISTS description TEXT;`,
    });
    results.push(err1 ? `description: ${err1.message}` : "description: OK");

    // Try adding documents_urls column
    const { error: err2 } = await supabaseAdmin.rpc("exec_sql", {
      sql: `ALTER TABLE epreuves ADD COLUMN IF NOT EXISTS documents_urls JSONB DEFAULT '[]'::jsonb;`,
    });
    results.push(
      err2 ? `documents_urls: ${err2.message}` : "documents_urls: OK",
    );

    return Response.json({
      success: true,
      message:
        "Migration attempted. If rpc exec_sql is not available, add columns manually in Supabase Dashboard.",
      results,
    });
  } catch (error) {
    console.error("Migration error:", error);
    return Response.json(
      {
        error: "Migration failed — add columns manually in Supabase SQL Editor",
        sql: [
          "ALTER TABLE epreuves ADD COLUMN IF NOT EXISTS description TEXT;",
          "ALTER TABLE epreuves ADD COLUMN IF NOT EXISTS documents_urls JSONB DEFAULT '[]'::jsonb;",
        ],
        details: String(error),
      },
      { status: 500 },
    );
  }
}
