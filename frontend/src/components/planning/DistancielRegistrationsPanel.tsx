"use client";

/**
 * DistancielRegistrationsPanel — inscrits d'une épreuve en distanciel.
 *
 * Une épreuve en distanciel n'a ni salle ni créneau (lib/distanciel.ts) : la
 * page Planning affiche à la place qui s'y est inscrit, avec un accès direct
 * à la notation et la copie des adresses (les documents partent hors
 * application). Lecture seule sur GET /api/epreuves/[id]/registrations.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Copy, Loader2, RefreshCw } from "lucide-react";
import api from "@/lib/api";
import { useToast } from "@/components/ui/toast";

interface Registration {
  candidateId: string;
  firstName: string;
  lastName: string;
  email: string;
  registeredAt: string;
}

export default function DistancielRegistrationsPanel({
  epreuveId,
  epreuveName,
}: {
  epreuveId: string;
  epreuveName: string;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Registration[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/epreuves/${epreuveId}/registrations`);
      setRows(res.data?.registrations || []);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Impossible de charger les inscrits.");
    } finally {
      setLoading(false);
    }
  }, [epreuveId]);

  useEffect(() => {
    load();
  }, [load]);

  const copyEmails = async () => {
    const emails = rows.map((r) => r.email).filter(Boolean).join(", ");
    try {
      await navigator.clipboard.writeText(emails);
      toast(`${rows.length} adresse(s) copiée(s)`, "success");
    } catch {
      toast("Copie impossible : sélectionnez les adresses à la main.", "error");
    }
  };

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            💻 {epreuveName} — épreuve à distance
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Pas de salle ni de créneau : les candidats s&apos;inscrivent depuis
            leur page Épreuves, et les documents leur sont envoyés hors
            application.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {rows.length > 0 && (
            <button
              onClick={copyEmails}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              <Copy size={13} /> Copier les e-mails
            </button>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Actualiser
          </button>
        </div>
      </div>

      {loading && rows.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-gray-500 py-6 justify-center">
          <Loader2 size={16} className="animate-spin" /> Chargement des inscrits…
        </div>
      ) : error ? (
        <p className="text-sm text-red-600 py-4">{error}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500 py-4">Aucun candidat inscrit pour le moment.</p>
      ) : (
        <>
          <p className="text-sm font-semibold text-gray-800 mb-2">
            {rows.length} candidat{rows.length > 1 ? "s" : ""} inscrit
            {rows.length > 1 ? "s" : ""}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  <th className="py-2 pr-3 font-medium">Candidat</th>
                  <th className="py-2 pr-3 font-medium">E-mail</th>
                  <th className="py-2 pr-3 font-medium">Inscrit le</th>
                  <th className="py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.candidateId} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 pr-3 text-gray-900">
                      {r.firstName} {r.lastName}
                    </td>
                    <td className="py-2 pr-3 text-gray-600 break-all">{r.email}</td>
                    <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">
                      {new Date(r.registeredAt).toLocaleString("fr-FR", {
                        timeZone: "Europe/Paris",
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>
                    <td className="py-2 text-right">
                      <Link
                        href={`/dashboard/candidates/${r.candidateId}/evaluate?epreuveId=${epreuveId}`}
                        className="text-xs font-semibold text-blue-600 hover:underline whitespace-nowrap"
                      >
                        Noter
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
