import { createClient } from "@/lib/supabase/server";
import { encryptData, decryptData } from "@/lib/crypto";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Verify user is authenticated
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch employee from database (encrypted fields included)
    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: "Employee not found" },
        { status: 404 }
      );
    }

    // Decrypt sensitive fields
    const decrypted: any = { ...data };

    if (
      data.nss_encrypted_data &&
      data.nss_iv &&
      data.nss_auth_tag
    ) {
      try {
        decrypted.nss = decryptData({
          encrypted_data: data.nss_encrypted_data,
          iv: data.nss_iv,
          auth_tag: data.nss_auth_tag,
        });
      } catch (e) {
        console.error("Failed to decrypt NSS:", e);
      }
    }

    if (
      data.iban_encrypted_data &&
      data.iban_iv &&
      data.iban_auth_tag
    ) {
      try {
        decrypted.iban = decryptData({
          encrypted_data: data.iban_encrypted_data,
          iv: data.iban_iv,
          auth_tag: data.iban_auth_tag,
        });
      } catch (e) {
        console.error("Failed to decrypt IBAN:", e);
      }
    }

    if (
      data.address_encrypted_data &&
      data.address_iv &&
      data.address_auth_tag
    ) {
      try {
        decrypted.address = decryptData({
          encrypted_data: data.address_encrypted_data,
          iv: data.address_iv,
          auth_tag: data.address_auth_tag,
        });
      } catch (e) {
        console.error("Failed to decrypt address:", e);
      }
    }

    if (
      data.dob_encrypted_data &&
      data.dob_iv &&
      data.dob_auth_tag
    ) {
      try {
        decrypted.dob = decryptData({
          encrypted_data: data.dob_encrypted_data,
          iv: data.dob_iv,
          auth_tag: data.dob_auth_tag,
        });
      } catch (e) {
        console.error("Failed to decrypt DOB:", e);
      }
    }

    // Remove encrypted fields from response
    delete decrypted.nss_encrypted_data;
    delete decrypted.nss_iv;
    delete decrypted.nss_auth_tag;
    delete decrypted.iban_encrypted_data;
    delete decrypted.iban_iv;
    delete decrypted.iban_auth_tag;
    delete decrypted.address_encrypted_data;
    delete decrypted.address_iv;
    delete decrypted.address_auth_tag;
    delete decrypted.dob_encrypted_data;
    delete decrypted.dob_iv;
    delete decrypted.dob_auth_tag;

    return NextResponse.json(decrypted);
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Verify user is authenticated
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    const {
      first_name,
      last_name,
      email,
      phone,
      position,
      department,
      hire_date,
      status,
      nss,
      iban,
      address,
      dob,
    } = body;

    // Build update object
    const updateData: any = {
      updated_by: user.id,
    };

    // Add public fields if provided
    if (first_name !== undefined) updateData.first_name = first_name;
    if (last_name !== undefined) updateData.last_name = last_name;
    if (email !== undefined) updateData.email = email;
    if (phone !== undefined) updateData.phone = phone;
    if (position !== undefined) updateData.position = position;
    if (department !== undefined) updateData.department = department;
    if (hire_date !== undefined) updateData.hire_date = hire_date;
    if (status !== undefined) updateData.status = status;

    // Encrypt and add sensitive fields if provided
    if (nss !== undefined) {
      const encrypted = nss ? encryptData(nss) : null;
      updateData.nss_encrypted_data = encrypted?.encrypted_data || null;
      updateData.nss_iv = encrypted?.iv || null;
      updateData.nss_auth_tag = encrypted?.auth_tag || null;
    }

    if (iban !== undefined) {
      const encrypted = iban ? encryptData(iban) : null;
      updateData.iban_encrypted_data = encrypted?.encrypted_data || null;
      updateData.iban_iv = encrypted?.iv || null;
      updateData.iban_auth_tag = encrypted?.auth_tag || null;
    }

    if (address !== undefined) {
      const encrypted = address ? encryptData(address) : null;
      updateData.address_encrypted_data = encrypted?.encrypted_data || null;
      updateData.address_iv = encrypted?.iv || null;
      updateData.address_auth_tag = encrypted?.auth_tag || null;
    }

    if (dob !== undefined) {
      const encrypted = dob ? encryptData(dob) : null;
      updateData.dob_encrypted_data = encrypted?.encrypted_data || null;
      updateData.dob_iv = encrypted?.iv || null;
      updateData.dob_auth_tag = encrypted?.auth_tag || null;
    }

    // Update database
    const { data, error } = await supabase
      .from("employees")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("Database error:", error);
      return NextResponse.json(
        { error: "Failed to update employee" },
        { status: 500 }
      );
    }

    // Decrypt sensitive fields for response
    const decrypted: any = { ...data };

    if (
      data.nss_encrypted_data &&
      data.nss_iv &&
      data.nss_auth_tag
    ) {
      try {
        decrypted.nss = decryptData({
          encrypted_data: data.nss_encrypted_data,
          iv: data.nss_iv,
          auth_tag: data.nss_auth_tag,
        });
      } catch (e) {
        console.error("Failed to decrypt NSS:", e);
      }
    }

    if (
      data.iban_encrypted_data &&
      data.iban_iv &&
      data.iban_auth_tag
    ) {
      try {
        decrypted.iban = decryptData({
          encrypted_data: data.iban_encrypted_data,
          iv: data.iban_iv,
          auth_tag: data.iban_auth_tag,
        });
      } catch (e) {
        console.error("Failed to decrypt IBAN:", e);
      }
    }

    if (
      data.address_encrypted_data &&
      data.address_iv &&
      data.address_auth_tag
    ) {
      try {
        decrypted.address = decryptData({
          encrypted_data: data.address_encrypted_data,
          iv: data.address_iv,
          auth_tag: data.address_auth_tag,
        });
      } catch (e) {
        console.error("Failed to decrypt address:", e);
      }
    }

    if (
      data.dob_encrypted_data &&
      data.dob_iv &&
      data.dob_auth_tag
    ) {
      try {
        decrypted.dob = decryptData({
          encrypted_data: data.dob_encrypted_data,
          iv: data.dob_iv,
          auth_tag: data.dob_auth_tag,
        });
      } catch (e) {
        console.error("Failed to decrypt DOB:", e);
      }
    }

    // Remove encrypted fields from response
    delete decrypted.nss_encrypted_data;
    delete decrypted.nss_iv;
    delete decrypted.nss_auth_tag;
    delete decrypted.iban_encrypted_data;
    delete decrypted.iban_iv;
    delete decrypted.iban_auth_tag;
    delete decrypted.address_encrypted_data;
    delete decrypted.address_iv;
    delete decrypted.address_auth_tag;
    delete decrypted.dob_encrypted_data;
    delete decrypted.dob_iv;
    delete decrypted.dob_auth_tag;

    return NextResponse.json(decrypted);
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
