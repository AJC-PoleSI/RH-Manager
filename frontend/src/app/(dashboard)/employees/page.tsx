import Link from "next/link";
import { EmployeesTable } from "@/components/tables/EmployeesTable";
import { createClient } from "@/lib/supabase/server";

export default async function EmployeesPage() {
  const supabase = await createClient();

  // Fetch employees list
  const { data: employees, error } = await supabase
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
      created_at
    `
    )
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching employees:", error);
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Employés</h1>
          <p className="mt-2 text-gray-600">
            Gérez les informations de vos employés
          </p>
        </div>
        <Link
          href="/employees/new"
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition"
        >
          + Nouvel employé
        </Link>
      </div>

      {employees && employees.length > 0 ? (
        <div className="bg-white rounded-lg shadow">
          <EmployeesTable employees={employees} />
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-500 mb-4">Aucun employé actif trouvé</p>
          <Link
            href="/employees/new"
            className="text-blue-600 hover:text-blue-900"
          >
            Créer le premier employé
          </Link>
        </div>
      )}
    </div>
  );
}
