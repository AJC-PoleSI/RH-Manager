import Link from "next/link";
import { EmployeeForm } from "@/components/forms/EmployeeForm";
import { createClient } from "@/lib/supabase/server";
import { decryptData } from "@/lib/crypto";

export default async function EditEmployeePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // Fetch employee (encrypted fields included)
  const { data: employee, error } = await supabase
    .from("employees")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !employee) {
    return (
      <div className="space-y-6">
        <Link href="/employees" className="text-blue-600 hover:text-blue-900">
          ← Retour
        </Link>
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <p className="text-red-700">Employé non trouvé</p>
        </div>
      </div>
    );
  }

  // Decrypt sensitive fields
  const decrypted: any = { ...employee };

  if (employee.nss_encrypted_data && employee.nss_iv && employee.nss_auth_tag) {
    try {
      decrypted.nss = decryptData({
        encrypted_data: employee.nss_encrypted_data,
        iv: employee.nss_iv,
        auth_tag: employee.nss_auth_tag,
      });
    } catch (e) {
      console.error("Failed to decrypt NSS:", e);
    }
  }

  if (
    employee.iban_encrypted_data &&
    employee.iban_iv &&
    employee.iban_auth_tag
  ) {
    try {
      decrypted.iban = decryptData({
        encrypted_data: employee.iban_encrypted_data,
        iv: employee.iban_iv,
        auth_tag: employee.iban_auth_tag,
      });
    } catch (e) {
      console.error("Failed to decrypt IBAN:", e);
    }
  }

  if (
    employee.address_encrypted_data &&
    employee.address_iv &&
    employee.address_auth_tag
  ) {
    try {
      decrypted.address = decryptData({
        encrypted_data: employee.address_encrypted_data,
        iv: employee.address_iv,
        auth_tag: employee.address_auth_tag,
      });
    } catch (e) {
      console.error("Failed to decrypt address:", e);
    }
  }

  if (employee.dob_encrypted_data && employee.dob_iv && employee.dob_auth_tag) {
    try {
      decrypted.dob = decryptData({
        encrypted_data: employee.dob_encrypted_data,
        iv: employee.dob_iv,
        auth_tag: employee.dob_auth_tag,
      });
    } catch (e) {
      console.error("Failed to decrypt DOB:", e);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/employees/${id}`} className="text-blue-600 hover:text-blue-900">
          ← Retour
        </Link>
        <h1 className="text-3xl font-bold text-gray-900 mt-2">
          Modifier {decrypted.first_name} {decrypted.last_name}
        </h1>
        <p className="mt-2 text-gray-600">
          Mettez à jour les informations de l'employé
        </p>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <EmployeeForm initialData={decrypted} isEditing={true} />
      </div>
    </div>
  );
}
