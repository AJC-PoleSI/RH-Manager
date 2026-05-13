"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Employee {
  id?: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  position: string;
  department?: string;
  hire_date?: string;
  nss?: string;
  iban?: string;
  address?: string;
  dob?: string;
}

interface EmployeeFormProps {
  initialData?: Employee;
  isEditing?: boolean;
}

export function EmployeeForm({
  initialData,
  isEditing = false,
}: EmployeeFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState<Employee>(
    initialData || {
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
      position: "",
      department: "",
      hire_date: "",
      nss: "",
      iban: "",
      address: "",
      dob: "",
    }
  );

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const url = isEditing
        ? `/api/employees/${initialData?.id}`
        : "/api/employees";

      const method = isEditing ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to save employee");
      }

      // Redirect to employees list
      router.push("/employees");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="first_name"
            className="block text-sm font-medium text-gray-700"
          >
            Prénom *
          </label>
          <input
            type="text"
            id="first_name"
            name="first_name"
            value={formData.first_name}
            onChange={handleChange}
            required
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div>
          <label
            htmlFor="last_name"
            className="block text-sm font-medium text-gray-700"
          >
            Nom *
          </label>
          <input
            type="text"
            id="last_name"
            name="last_name"
            value={formData.last_name}
            onChange={handleChange}
            required
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-gray-700"
          >
            Email *
          </label>
          <input
            type="email"
            id="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            required
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div>
          <label
            htmlFor="phone"
            className="block text-sm font-medium text-gray-700"
          >
            Téléphone
          </label>
          <input
            type="tel"
            id="phone"
            name="phone"
            value={formData.phone || ""}
            onChange={handleChange}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div>
          <label
            htmlFor="position"
            className="block text-sm font-medium text-gray-700"
          >
            Poste *
          </label>
          <input
            type="text"
            id="position"
            name="position"
            value={formData.position}
            onChange={handleChange}
            required
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div>
          <label
            htmlFor="department"
            className="block text-sm font-medium text-gray-700"
          >
            Département
          </label>
          <input
            type="text"
            id="department"
            name="department"
            value={formData.department || ""}
            onChange={handleChange}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div>
          <label
            htmlFor="hire_date"
            className="block text-sm font-medium text-gray-700"
          >
            Date d&apos;embauche
          </label>
          <input
            type="date"
            id="hire_date"
            name="hire_date"
            value={formData.hire_date || ""}
            onChange={handleChange}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div>
          <label
            htmlFor="dob"
            className="block text-sm font-medium text-gray-700"
          >
            Date de naissance (chiffré)
          </label>
          <input
            type="date"
            id="dob"
            name="dob"
            value={formData.dob || ""}
            onChange={handleChange}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div>
          <label
            htmlFor="nss"
            className="block text-sm font-medium text-gray-700"
          >
            NSS (chiffré)
          </label>
          <input
            type="text"
            id="nss"
            name="nss"
            value={formData.nss || ""}
            onChange={handleChange}
            placeholder="Numéro de sécurité sociale"
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div>
          <label
            htmlFor="iban"
            className="block text-sm font-medium text-gray-700"
          >
            IBAN (chiffré)
          </label>
          <input
            type="text"
            id="iban"
            name="iban"
            value={formData.iban || ""}
            onChange={handleChange}
            placeholder="Numéro de compte bancaire"
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div className="md:col-span-2">
          <label
            htmlFor="address"
            className="block text-sm font-medium text-gray-700"
          >
            Adresse (chiffré)
          </label>
          <input
            type="text"
            id="address"
            name="address"
            value={formData.address || ""}
            onChange={handleChange}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      <div className="flex gap-4">
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
        >
          {loading ? "Enregistrement..." : isEditing ? "Mettre à jour" : "Créer"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
        >
          Annuler
        </button>
      </div>
    </form>
  );
}
