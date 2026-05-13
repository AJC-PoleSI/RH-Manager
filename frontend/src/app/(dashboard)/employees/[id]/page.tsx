import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { decryptData } from "@/lib/crypto";

export default async function EmployeeDetailPage({
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
      <div className="flex justify-between items-center">
        <div>
          <Link href="/employees" className="text-blue-600 hover:text-blue-900">
            ← Retour
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 mt-2">
            {decrypted.first_name} {decrypted.last_name}
          </h1>
          <p className="text-gray-600">{decrypted.position}</p>
        </div>
        <Link
          href={`/employees/${id}/edit`}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition"
        >
          Modifier
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Public Information */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Informations générales
          </h2>
          <dl className="space-y-4">
            <div>
              <dt className="text-sm font-medium text-gray-500">Email</dt>
              <dd className="mt-1 text-sm text-gray-900">{decrypted.email}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Téléphone</dt>
              <dd className="mt-1 text-sm text-gray-900">
                {decrypted.phone || "-"}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Département</dt>
              <dd className="mt-1 text-sm text-gray-900">
                {decrypted.department || "-"}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">
                Date d&apos;embauche
              </dt>
              <dd className="mt-1 text-sm text-gray-900">
                {decrypted.hire_date || "-"}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Statut</dt>
              <dd className="mt-1">
                <span
                  className={`px-2 py-1 text-xs font-semibold rounded-full ${
                    decrypted.status === "active"
                      ? "bg-green-100 text-green-800"
                      : decrypted.status === "inactive"
                        ? "bg-yellow-100 text-yellow-800"
                        : "bg-gray-100 text-gray-800"
                  }`}
                >
                  {decrypted.status}
                </span>
              </dd>
            </div>
          </dl>
        </div>

        {/* Encrypted Information */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Informations sensibles (chiffrées)
          </h2>
          <dl className="space-y-4">
            <div>
              <dt className="text-sm font-medium text-gray-500">
                Date de naissance
              </dt>
              <dd className="mt-1 text-sm text-gray-900">
                {decrypted.dob || "-"}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">NSS</dt>
              <dd className="mt-1 text-sm font-mono text-gray-900 break-all">
                {decrypted.nss ? `${decrypted.nss.substring(0, 5)}...` : "-"}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">IBAN</dt>
              <dd className="mt-1 text-sm font-mono text-gray-900 break-all">
                {decrypted.iban ? `${decrypted.iban.substring(0, 4)}...` : "-"}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Adresse</dt>
              <dd className="mt-1 text-sm text-gray-900">
                {decrypted.address || "-"}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-gray-500">
            Les données sensibles sont chiffrées en AES-256-GCM et stockées de
            manière sécurisée.
          </p>
        </div>
      </div>
    </div>
  );
}
