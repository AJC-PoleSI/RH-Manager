import Link from "next/link";
import { EmployeeForm } from "@/components/forms/EmployeeForm";

export default function NewEmployeePage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/employees" className="text-blue-600 hover:text-blue-900">
          ← Retour
        </Link>
        <h1 className="text-3xl font-bold text-gray-900 mt-2">
          Créer un nouvel employé
        </h1>
        <p className="mt-2 text-gray-600">
          Remplissez le formulaire pour créer un nouvel employé. Les champs
          marqués avec * sont obligatoires.
        </p>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <EmployeeForm />
      </div>
    </div>
  );
}
