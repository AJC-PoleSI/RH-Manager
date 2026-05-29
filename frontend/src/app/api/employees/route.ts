import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { encryptData } from "@/lib/crypto";
import { NextRequest, NextResponse } from "next/server";

// ════════════════════════════════════════════════════════════════════
// SECURITY (audit SEC-002) : la table employees contient des données
// ultra-sensibles (NSS, IBAN, adresse, date de naissance chiffrées).
// L'accès est réservé aux ADMINS, via le même JWT maison que le reste
// de l'app (et non l'auth Supabase, incohérente avec le client front).
// ════════════════════════════════════════════════════════════════════

export async function POST(request: NextRequest) {
  const payload = getTokenFromRequest(request);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const body = await request.json();

    const {
      first_name,
      last_name,
      email,
      phone,
      position,
      department,
      hire_date,
      nss,
      iban,
      address,
      dob,
    } = body;

    // Validate required fields
    if (!first_name || !last_name || !email || !position) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Encrypt sensitive fields
    const encryptedNss = nss ? encryptData(nss) : null;
    const encryptedIban = iban ? encryptData(iban) : null;
    const encryptedAddress = address ? encryptData(address) : null;
    const encryptedDob = dob ? encryptData(dob) : null;

    // Insert into database
    const { data, error } = await supabaseAdmin
      .from("employees")
      .insert({
        first_name,
        last_name,
        email,
        phone,
        position,
        department,
        hire_date,
        nss_encrypted_data: encryptedNss?.encrypted_data,
        nss_iv: encryptedNss?.iv,
        nss_auth_tag: encryptedNss?.auth_tag,
        iban_encrypted_data: encryptedIban?.encrypted_data,
        iban_iv: encryptedIban?.iv,
        iban_auth_tag: encryptedIban?.auth_tag,
        address_encrypted_data: encryptedAddress?.encrypted_data,
        address_iv: encryptedAddress?.iv,
        address_auth_tag: encryptedAddress?.auth_tag,
        dob_encrypted_data: encryptedDob?.encrypted_data,
        dob_iv: encryptedDob?.iv,
        dob_auth_tag: encryptedDob?.auth_tag,
        created_by: payload.id,
        updated_by: payload.id,
      })
      .select()
      .single();

    if (error) {
      console.error("Database error:", error);
      return NextResponse.json(
        { error: "Failed to create employee" },
        { status: 500 }
      );
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const payload = getTokenFromRequest(request);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    // Get query parameters for filtering
    const searchParams = request.nextUrl.searchParams;
    const department = searchParams.get("department");
    const status = searchParams.get("status") || "active";

    let query = supabaseAdmin
      .from("employees")
      .select(
        `
        id,
        first_name,
        last_name,
        email,
        phone,
        position,
        department,
        hire_date,
        status,
        created_at,
        updated_at
      `
      )
      .eq("status", status);

    if (department) {
      query = query.eq("department", department);
    }

    const { data, error } = await query.order("created_at", {
      ascending: false,
    });

    if (error) {
      console.error("Database error:", error);
      return NextResponse.json(
        { error: "Failed to fetch employees" },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
