import { getSupabaseAdmin } from "@/lib/supabase"
import { NextResponse } from "next/server"

export async function GET() {
  try {
    const supabase = getSupabaseAdmin()
    const { error } = await supabase.from("candidates").select("id").limit(1)

    if (error) {
      return NextResponse.json({ status: "error", error: error.message }, { status: 500 })
    }

    return NextResponse.json({ status: "ok", timestamp: new Date().toISOString() })
  } catch (e) {
    return NextResponse.json({ status: "error", error: String(e) }, { status: 500 })
  }
}
