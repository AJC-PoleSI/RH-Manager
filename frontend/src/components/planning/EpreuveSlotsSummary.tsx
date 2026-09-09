"use client";

/**
 * EpreuveSlotsSummary — combien de créneaux sont réellement prêts, par épreuve.
 *
 * « Prêt » = un créneau qui a déjà au moins le nombre minimum d'examinateurs
 * requis (slot.min_members) affecté — donc staffé, indépendamment de son
 * statut publié/pas publié. Lecture seule sur /api/slots/all, même source que
 * EnrollmentsTable et le calendrier de contrôle : aucune nouvelle logique de
 * calcul, juste un comptage.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import api from "@/lib/api";

interface Row {
  epreuveId: string;
  epreuveName: string;
  tour: string | number;
  total: number;
  prets: number;
  incomplets: number;
  vides: number;
}

export default function EpreuveSlotsSummary() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/slots/all");
      const slots: any[] = res.data || [];
      const byEpreuve = new Map<string, Row>();
      for (const s of slots) {
        const ep = s.epreuve;
        if (!ep) continue;
        const row = byEpreuve.get(ep.id) || {
          epreuveId: ep.id,
          epreuveName: ep.name,
          tour: ep.tour,
          total: 0,
          prets: 0,
          incomplets: 0,
          vides: 0,
        };
        const assigned = (s.members || []).length;
        const min = s.min_members || 1;
        row.total += 1;
        if (assigned === 0) row.vides += 1;
        else if (assigned >= min) row.prets += 1;
        else row.incomplets += 1;
        byEpreuve.set(ep.id, row);
      }
      setRows(
        Array.from(byEpreuve.values()).sort(
          (a, b) =>
            String(a.tour).localeCompare(String(b.tour), undefined, {
              numeric: true,
            }) || a.epreuveName.localeCompare(b.epreuveName),
        ),
      );
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({ total: acc.total + r.total, prets: acc.prets + r.prets }),
        { total: 0, prets: 0 },
      ),
    [rows],
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">
            Créneaux prêts par épreuve
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            « Prêt » = au moins le minimum d&apos;examinateurs déjà affecté sur
            le créneau.
          </p>
        </div>
        <button
          onClick={load}
          className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-50"
          aria-label="Actualiser"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loading && rows.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-400 text-center">
          Aucun créneau ouvert pour le moment.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                <th className="px-4 py-2 font-medium">Épreuve</th>
                <th className="px-3 py-2 font-medium text-center">Tour</th>
                <th className="px-3 py-2 font-medium text-center">Prêts</th>
                <th className="px-3 py-2 font-medium text-center">
                  Incomplets
                </th>
                <th className="px-3 py-2 font-medium text-center">Vides</th>
                <th className="px-3 py-2 font-medium text-center">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((r) => (
                <tr key={r.epreuveId} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium text-gray-900">
                    {r.epreuveName}
                  </td>
                  <td className="px-3 py-2 text-center text-gray-600">
                    {r.tour}
                  </td>
                  <td className="px-3 py-2 text-center font-semibold text-green-700">
                    {r.prets}
                  </td>
                  <td className="px-3 py-2 text-center text-amber-600">
                    {r.incomplets}
                  </td>
                  <td className="px-3 py-2 text-center text-gray-400">
                    {r.vides}
                  </td>
                  <td className="px-3 py-2 text-center text-gray-500">
                    {r.total}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50 font-medium">
                <td className="px-4 py-2" colSpan={2}>
                  Total
                </td>
                <td className="px-3 py-2 text-center text-green-700">
                  {totals.prets}
                </td>
                <td className="px-3 py-2 text-center" colSpan={2}></td>
                <td className="px-3 py-2 text-center text-gray-600">
                  {totals.total}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
