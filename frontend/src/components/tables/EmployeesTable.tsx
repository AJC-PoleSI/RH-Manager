"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, Edit, Trash2 } from "lucide-react";

interface Employee {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  position: string;
  department?: string;
  hire_date?: string;
  status: string;
  created_at: string;
}

interface EmployeesTableProps {
  employees: Employee[];
  onDelete?: (id: string) => Promise<void>;
}

export function EmployeesTable({
  employees,
  onDelete,
}: EmployeesTableProps) {
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this employee?")) {
      return;
    }

    setDeleting(id);
    try {
      if (onDelete) {
        await onDelete(id);
      }
    } finally {
      setDeleting(null);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-green-100 text-green-800";
      case "inactive":
        return "bg-yellow-100 text-yellow-800";
      case "archived":
        return "bg-gray-100 text-gray-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Nom
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Email
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Poste
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Département
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Statut
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {employees.map((employee) => (
            <tr key={employee.id} className="hover:bg-gray-50">
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                {employee.first_name} {employee.last_name}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                {employee.email}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                {employee.position}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                {employee.department || "-"}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span
                  className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(
                    employee.status
                  )}`}
                >
                  {employee.status}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                <Link
                  href={`/employees/${employee.id}`}
                  className="text-blue-600 hover:text-blue-900"
                  title="View details"
                >
                  <Eye className="inline w-4 h-4" />
                </Link>
                <Link
                  href={`/employees/${employee.id}/edit`}
                  className="text-amber-600 hover:text-amber-900"
                  title="Edit"
                >
                  <Edit className="inline w-4 h-4" />
                </Link>
                <button
                  onClick={() => handleDelete(employee.id)}
                  disabled={deleting === employee.id}
                  className="text-red-600 hover:text-red-900 disabled:text-gray-400"
                  title="Delete"
                >
                  <Trash2 className="inline w-4 h-4" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {employees.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500">Aucun employé trouvé</p>
        </div>
      )}
    </div>
  );
}
