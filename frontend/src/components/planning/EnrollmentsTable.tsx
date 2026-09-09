"use client";

/**
 * EnrollmentsTable — qui s'est inscrit, en un coup d'œil.
 *
 * Vue tableau globale : une ligne par personne inscrite sur un créneau
 * (examinateur affecté OU candidat inscrit), filtrable par tour, épreuve,
 * salle, rôle, et recherche libre. Complète — ne remplace pas — le clic sur
 * un créneau dans le calendrier de contrôle, qui reste la vue détaillée
 * d'UN créneau ; ici c'est la vue d'ensemble.
 *
 * Lecture seule : cette table n'écrit jamais rien, elle affiche
 * /api/slots/all tel quel (source déjà utilisée par le calendrier de
 * contrôle et le dispatch — pas de nouvelle logique de calcul).
 */

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Loader2, RefreshCw, Search } from "lucide-react";
import api from "@/lib/api";
import { isActiveEnrollment } from "@/lib/enrollment";
import { cn } from "@/lib/utils";

interface EpreuveOption {
  id: string;
  name: string;
  tour: string | number;
}

interface Props {
  epreuves: EpreuveOption[];
}

type Role = "examinateur" | "candidat";

interface Row {
  slotId: string;
  date: string; // "YYYY-MM-DD"
  startTime: string;
  endTime: string;
  room: string;
  epreuveId: string;
  epreuveName: string;
  tour: string;
  role: Role;
  name: string;
  email: string;
  cancelled: boolean;
}

function personName(p: any): string {
  const first = p?.first_name || p?.firstName;
  const last = p?.last_name || p?.lastName;
  const full = `${first ?? ""} ${last ?? ""}`.trim();
  return full || p?.email || "—";
}

export default function EnrollmentsTable({ epreuves }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const [tourFilter, setTourFilter] = useState<string>("");
  const [epreuveFilter, setEpreuveFilter] = useState<string>("");
  const [roleFilter, setRoleFilter] = useState<"" | Role>("");
  const [search, setSearch] = useState("");

  const tours = useMemo(
    () => Array.from(new Set(epreuves.map((e) => String(e.tour)))).sort(),
    [epreuves],
  );
  const epreuvesForTour = useMemo(
    () =>
      tourFilter ? epreuves.filter((e) => String(e.tour) === tourFilter) : epreuves,
    [epreuves, tourFilter],
  );

  const load = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (tourFilter) params.tour = tourFilter;
      const res = await api.get("/slots/all", {
        headers: { "Cache-Control": "no-store" },
        params: { ...params, t: Date.now() },
      });
      const slots = Array.isArray(res.data) ? res.data : [];
      const next: Row[] = [];
      for (const s of slots) {
        const base = {
          slotId: s.id,
          date: String(s.date).slice(0, 10),
          startTime: String(s.start_time || "").slice(0, 5),
          endTime: String(s.end_time || "").slice(0, 5),
          room: s.room || "—",
          epreuveId: s.epreuve?.id || s.epreuve_id || "",
          epreuveName: (s.epreuve?.name || "").trim() || "—",
          tour: String(s.epreuve?.tour ?? s.tour ?? ""),
        };
        for (const m of s.members || []) {
          next.push({
            ...base,
            role: "examinateur",
            name: personName(m.member),
            email: m.member?.email || "",
            cancelled: false,
          });
        }
        for (const e of s.enrollments || []) {
          next.push({
            ...base,
            role: "candidat",
            name: personName(e.candidate),
            email: e.candidate?.email || "",
            cancelled: !isActiveEnrollment(e.status),
          });
        }
      }
      next.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
      setRows(next);
      setLoadedOnce(true);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && !loadedOnce) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Un changement de tour invalide la liste d'épreuves affichable : on
  // efface un filtre épreuve devenu incohérent plutôt que de le laisser
  // filtrer sur un id qui n'existe plus dans le tour choisi.
  useEffect(() => {
    if (epreuveFilter && !epreuvesForTour.some((e) => e.id === epreuveFilter)) {
      setEpreuveFilter("");
    }
  }, [epreuveFilter, epreuvesForTour]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (tourFilter && r.tour !== tourFilter) return false;
      if (epreuveFilter && r.epreuveId !== epreuveFilter) return false;
      if (roleFilter && r.role !== roleFilter) return false;
      if (q && !`${r.name} ${r.email}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, tourFilter, epreuveFilter, roleFilter, search]);

  const examCount = filtered.filter((r) => r.role === "examinateur").length;
  const candCount = filtered.filter(
    (r) => r.role === "candidat" && !r.cancelled,
  ).length;

  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          📋 Inscrits
          {loadedOnce && (
            <span className="font-normal text-gray-400">
              — {examCount} examinateur{examCount > 1 ? "s" : ""} ·{" "}
              {candCount} candidat{candCount > 1 ? "s" : ""}
            </span>
          )}
        </span>
        <ChevronRight
          className={cn(
            "h-4 w-4 text-gray-400 transition-transform",
            open && "rotate-90",
          )}
        />
      </button>

      {open && (
        <div className="border-t border-gray-100 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <select
              value={tourFilter}
              onChange={(e) => setTourFilter(e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            >
              <option value="">Tous les tours</option>
              {tours.map((t) => (
                <option key={t} value={t}>
                  Tour {t}
                </option>
              ))}
            </select>

            <select
              value={epreuveFilter}
              onChange={(e) => setEpreuveFilter(e.target.value)}
              className="max-w-[220px] rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            >
              <option value="">Toutes les épreuves</option>
              {epreuvesForTour.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>

            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as "" | Role)}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            >
              <option value="">Examinateurs + candidats</option>
              <option value="examinateur">Examinateurs seulement</option>
              <option value="candidat">Candidats seulement</option>
            </select>

            <div className="relative flex-1 min-w-[160px]">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un nom, un email…"
                className="w-full rounded-md border border-gray-300 py-1.5 pl-7 pr-2 text-sm"
              />
            </div>

            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="ml-auto flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Actualiser
            </button>
          </div>

          {loading && rows.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">
              Aucune inscription ne correspond à ces filtres.
            </p>
          ) : (
            <div className="max-h-[480px] overflow-auto rounded-lg border border-gray-100">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-500">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Horaire</th>
                    <th className="px-3 py-2">Salle</th>
                    <th className="px-3 py-2">Épreuve</th>
                    <th className="px-3 py-2">Tour</th>
                    <th className="px-3 py-2">Rôle</th>
                    <th className="px-3 py-2">Nom</th>
                    <th className="px-3 py-2">Email</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => (
                    <tr
                      key={`${r.slotId}-${r.role}-${r.email}-${i}`}
                      className={cn(
                        "border-t border-gray-50",
                        r.cancelled && "opacity-40",
                      )}
                    >
                      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                        {r.date}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-gray-500">
                        {r.startTime}–{r.endTime}
                      </td>
                      <td className="px-3 py-1.5">{r.room}</td>
                      <td className="px-3 py-1.5">{r.epreuveName}</td>
                      <td className="px-3 py-1.5 text-gray-500">{r.tour}</td>
                      <td className="px-3 py-1.5">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs font-medium",
                            r.role === "examinateur"
                              ? "bg-blue-50 text-blue-700"
                              : "bg-emerald-50 text-emerald-700",
                          )}
                        >
                          {r.role === "examinateur" ? "Examinateur" : "Candidat"}
                        </span>
                        {r.cancelled && (
                          <span className="ml-1.5 text-xs text-red-500">
                            désinscrit
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 font-medium text-gray-900">
                        {r.name}
                      </td>
                      <td className="px-3 py-1.5 text-gray-500">{r.email}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
