"use client";

// Onglet « Coefficients » de la page Réglages (07/10/2026).
//
// Le poids d'une épreuve dans la moyenne d'un candidat est, par défaut,
// dérivé de son barème : total de la grille ÷ 20 (une épreuve /43 pèse 2,15,
// une épreuve /20 pèse 1). Ici l'admin peut le fixer à la main, épreuve par
// épreuve ; champ vide = automatique, c'est-à-dire exactement le calcul
// d'avant. Les épreuves d'un tour terminé sont en lecture seule — le serveur
// refuse de toute façon (PATCH /api/epreuves/[id]/coefficient, 409) : leurs
// moyennes ont déjà été délibérées.

import { useCallback, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import {
  effectiveCoefficient,
  getEpreuveCoefficient,
  getTotalMaxPoints,
  parseEpreuveCoefficient,
} from "@/lib/evaluation-criteria";
import { closedTourNumbers } from "@/lib/tour-archive";

/** Même borne que la route serveur. */
const MAX_COEFFICIENT = 100;

interface EpreuveRow {
  id: string;
  name: string;
  tour: number;
  /** Total de points de la grille principale. */
  maxTotal: number;
  /** Coefficient enregistré ; null = automatique. */
  coefficient: number | null;
  /** Deuxième grille (propale…) : toujours en poids automatique. */
  secondGrid: { title: string; maxTotal: number } | null;
}

/** « 2,15 » — un coefficient à la française, sans décimale inutile. */
const fmt = (n: number) =>
  n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

/**
 * Lit la saisie du champ « Coefficient choisi ». Vide = automatique (null).
 * La virgule française est acceptée (« 1,5 »).
 */
function parseDraft(
  raw: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  const s = raw.trim();
  if (s === "") return { ok: true, value: null };
  const n = Number(s.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: "Nombre strictement positif attendu" };
  }
  if (n > MAX_COEFFICIENT) {
    return { ok: false, error: `Au plus ${MAX_COEFFICIENT}` };
  }
  return { ok: true, value: n };
}

const toDraft = (coef: number | null) => (coef === null ? "" : fmt(coef));

export default function CoefficientsPanel() {
  const { toast } = useToast();
  const [rows, setRows] = useState<EpreuveRow[]>([]);
  const [closedTours, setClosedTours] = useState<Set<number>>(new Set());
  /** Statut des tours illisible : tout en lecture seule, par prudence. */
  const [toursUnknown, setToursUnknown] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [epRes, toursRes] = await Promise.allSettled([
      api.get("/epreuves"),
      api.get("/tours"),
    ]);

    if (epRes.status === "fulfilled") {
      const list: EpreuveRow[] = (Array.isArray(epRes.value.data) ? epRes.value.data : []).map(
        (e: any) => {
          const second = e.secondaryGrid?.questions
            ? {
                title: String(e.secondaryGrid.title || "Deuxième grille"),
                maxTotal: getTotalMaxPoints(e.secondaryGrid.questions),
              }
            : null;
          return {
            id: e.id,
            name: e.name || "Épreuve",
            tour: Number(e.tour) || 0,
            maxTotal: getTotalMaxPoints(e.evaluationQuestions),
            coefficient: parseEpreuveCoefficient(e.coefficient),
            secondGrid: second && second.maxTotal > 0 ? second : null,
          };
        },
      );
      setRows(list);
      setDrafts(Object.fromEntries(list.map((r) => [r.id, toDraft(r.coefficient)])));
    } else {
      setRows([]);
      setLoadError("Impossible de charger les épreuves.");
    }

    if (toursRes.status === "fulfilled") {
      setClosedTours(closedTourNumbers(toursRes.value.data));
      setToursUnknown(false);
    } else {
      setToursUnknown(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const byTour = useMemo(() => {
    const map = new Map<number, EpreuveRow[]>();
    for (const r of rows) {
      map.set(r.tour, [...(map.get(r.tour) || []), r]);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a - b)
      .map(([tour, list]) => ({
        tour,
        list: list.sort((a, b) => a.name.localeCompare(b.name, "fr")),
      }));
  }, [rows]);

  const handleSave = async (row: EpreuveRow) => {
    const parsed = parseDraft(drafts[row.id] ?? "");
    if (!parsed.ok) {
      toast(`${row.name} : ${parsed.error}.`, "error");
      return;
    }
    setSaving(row.id);
    try {
      const res = await api.patch(`/epreuves/${row.id}/coefficient`, {
        coefficient: parsed.value,
      });
      const saved = parseEpreuveCoefficient(res.data?.coefficient);
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, coefficient: saved } : r)),
      );
      setDrafts((prev) => ({ ...prev, [row.id]: toDraft(saved) }));
      toast(
        saved === null
          ? `${row.name} : coefficient automatique (${fmt(getEpreuveCoefficient(row.maxTotal))}).`
          : `${row.name} : coefficient ${fmt(saved)} enregistré.`,
        "success",
      );
    } catch (e: any) {
      toast(
        e?.response?.data?.error || "Échec de l'enregistrement du coefficient.",
        "error",
      );
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-[10px] p-[18px_20px] mb-[14px]">
      <h2 className="text-base font-semibold text-gray-900 mb-1">
        ⚖️ Coefficients
      </h2>
      <p className="text-sm text-gray-500 mb-4">
        Poids de chaque épreuve dans la moyenne d&apos;un candidat. Par défaut,
        il découle du barème : total de la grille ÷ 20 (une épreuve sur 40
        compte double, une épreuve sur 5 compte pour un quart). Saisir un
        coefficient le remplace ; laisser le champ vide revient au calcul
        automatique. Une note est toujours ramenée sur 20 avant d&apos;être
        pondérée.
      </p>

      {toursUnknown && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-4">
          Statut des tours illisible : tout est en lecture seule par prudence.
          Rechargez la page.
        </p>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Chargement…</p>
      ) : loadError ? (
        <p className="text-sm text-red-600">{loadError}</p>
      ) : byTour.length === 0 ? (
        <p className="text-sm text-gray-400">Aucune épreuve créée.</p>
      ) : (
        <div className="space-y-5">
          {byTour.map(({ tour, list }) => {
            const locked = toursUnknown || closedTours.has(tour);
            return (
              <div key={tour}>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <h3 className="text-sm font-semibold text-gray-800">
                    {tour > 0 ? `Tour ${tour}` : "Sans tour"}
                  </h3>
                  {closedTours.has(tour) && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                      Tour terminé — lecture seule
                    </span>
                  )}
                </div>
                {closedTours.has(tour) && (
                  <p className="text-xs text-gray-500 mb-2">
                    Les moyennes de ce tour ont déjà été délibérées : ses
                    coefficients sont figés. Réouvrir le tour (page
                    Délibérations) pour les modifier.
                  </p>
                )}
                <div className="border border-gray-200 rounded-[10px] overflow-hidden">
                  <div className="scroll-x">
                    <table className="w-full text-sm text-left min-w-[680px]">
                      <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                        <tr>
                          <th className="px-4 py-2.5 font-medium">Épreuve</th>
                          <th className="px-4 py-2.5 font-medium text-center">Total de la grille</th>
                          <th className="px-4 py-2.5 font-medium text-center">Poids automatique</th>
                          <th className="px-4 py-2.5 font-medium">Coefficient choisi</th>
                          <th className="px-4 py-2.5 font-medium text-center">Poids utilisé</th>
                          <th className="px-4 py-2.5 font-medium text-right" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {list.map((row) => {
                          const auto = getEpreuveCoefficient(row.maxTotal);
                          const used = effectiveCoefficient(row.coefficient, row.maxTotal);
                          const draft = drafts[row.id] ?? "";
                          const parsed = parseDraft(draft);
                          const dirty =
                            parsed.ok
                              ? parsed.value !== row.coefficient
                              : draft.trim() !== toDraft(row.coefficient);
                          const preview =
                            parsed.ok && dirty
                              ? effectiveCoefficient(parsed.value, row.maxTotal)
                              : null;
                          return (
                            <tr key={row.id} className="align-top">
                              <td className="px-4 py-3">
                                <div className="font-medium text-gray-900">{row.name}</div>
                                {row.secondGrid && (
                                  <div className="text-xs text-gray-500 mt-0.5">
                                    + {row.secondGrid.title} /{fmt(row.secondGrid.maxTotal)} :
                                    comptée à part, poids automatique{" "}
                                    {fmt(getEpreuveCoefficient(row.secondGrid.maxTotal))}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3 text-center text-gray-700">
                                {row.maxTotal > 0 ? `/${fmt(row.maxTotal)}` : "—"}
                              </td>
                              <td className="px-4 py-3 text-center text-gray-600">
                                {fmt(auto)}
                              </td>
                              <td className="px-4 py-3">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={draft}
                                  placeholder="Automatique"
                                  disabled={locked || saving === row.id}
                                  aria-label={`Coefficient choisi pour ${row.name}`}
                                  onChange={(e) =>
                                    setDrafts((prev) => ({ ...prev, [row.id]: e.target.value }))
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && !locked && dirty && parsed.ok) {
                                      handleSave(row);
                                    }
                                  }}
                                  className={`w-28 border rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500 ${
                                    parsed.ok ? "border-gray-300" : "border-red-400"
                                  }`}
                                />
                                {!parsed.ok && (
                                  <div className="text-xs text-red-600 mt-1">{parsed.error}</div>
                                )}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className="font-semibold text-gray-900">{fmt(used)}</span>
                                <span className="block text-xs text-gray-500">
                                  {row.coefficient === null ? "automatique" : "choisi"}
                                </span>
                                {preview !== null && (
                                  <span className="block text-xs text-blue-700 mt-0.5">
                                    → {fmt(preview)} après enregistrement
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right">
                                {!locked && (
                                  <button
                                    onClick={() => handleSave(row)}
                                    disabled={!dirty || !parsed.ok || saving === row.id}
                                    className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-md hover:bg-blue-700 disabled:opacity-40 transition-colors"
                                  >
                                    {saving === row.id ? "Enregistrement…" : "Enregistrer"}
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
