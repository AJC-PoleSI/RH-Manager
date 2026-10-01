"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import CriteriaScores from "@/components/evaluation/CriteriaScores";
import { hasAnyScore, sumScores, toTwenty } from "@/lib/evaluation-criteria";
import {
  averageStats,
  buildRows,
  columnStats,
  listColumns,
  sortRows,
  type ColumnStats,
  type GridCandidateInput,
  type GridRow,
  type GridSortKey,
} from "@/lib/notes-grid";
import type { Candidate } from "./page";

type Evaluation = NonNullable<Candidate["evaluations"]>[number];

const PREFS_KEY = "delib-notes-detail-prefs";

interface Prefs {
  groupByPole: boolean;
  showComments: boolean;
  showCriteria: boolean;
}

const DEFAULT_PREFS: Prefs = { groupByPole: false, showComments: false, showCriteria: false };

function readPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Une note compte si elle est remplie et n'est pas une ancienne note de groupe. */
const isCounted = (ev: Evaluation) => hasAnyScore(ev.scores) && !ev.isLegacyCollective;

const epreuveKeyOf = (ev: Evaluation) => ev.epreuve?.id || ev.epreuve?.name || "sans-epreuve";

function examinerLabel(ev: Evaluation): string {
  const list = ev.examiners?.length ? ev.examiners : ev.member ? [ev.member] : [];
  const names = list.map((m) => m.firstName || m.email).filter(Boolean);
  return names.length > 0 ? names.join(" & ") : "Évaluateur";
}

/** Libellé du pôle de 1er vœu (la page range les candidats sans vœu sous « Non renseigne »). */
const poleLabel = (pole: string) => (pole === "Non renseigne" ? "Vœux non renseignés" : pole);

function formatCoef(coef: number): string {
  return Number.isInteger(coef) ? String(coef) : coef.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function scoreTone(score: number): string {
  if (score >= 14) return "text-green-700";
  if (score < 10) return "text-red-600";
  return "text-gray-800";
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-blue-600" : "bg-gray-300"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : ""}`}
        />
      </button>
      <span>{label}</span>
    </label>
  );
}

function StatsCell({ s, strong = false }: { s: ColumnStats | null | undefined; strong?: boolean }) {
  if (!s) return <span className="text-gray-300">—</span>;
  return (
    <div className="flex flex-col items-center leading-tight" title={`${s.count} candidat${s.count > 1 ? "s" : ""} noté${s.count > 1 ? "s" : ""}`}>
      <span className={`${strong ? "font-bold text-gray-900" : "font-semibold text-gray-700"}`}>{s.average}</span>
      <span className="text-[10px] font-normal text-gray-400 normal-case">
        {s.min}–{s.max}
      </span>
    </div>
  );
}

export default function NotesDetailPanel({
  candidates,
  tour,
  isAdmin,
  questionsByEpreuve,
  getFirstPole,
  poleColor,
  renderDecision,
}: {
  /** Candidats du tour, déjà filtrés par pôle par la page. */
  candidates: Candidate[];
  tour: number;
  isAdmin: boolean;
  questionsByEpreuve: Record<string, unknown>;
  getFirstPole: (c: Candidate) => string;
  poleColor: (pole: string) => string;
  renderDecision: (c: Candidate) => ReactNode;
}) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  useEffect(() => setPrefs(readPrefs()), []);
  const updatePrefs = (patch: Partial<Prefs>) =>
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        /* stockage indisponible : préférence non retenue */
      }
      return next;
    });

  // Épreuves décochées (et non cochées) : une épreuve qui apparaît en cours de
  // soirée est ainsi affichée d'office.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ by: GridSortKey; dir: "asc" | "desc" }>({ by: "average", dir: "desc" });

  // Notes du tour, par candidat.
  const evalsByCandidate = useMemo(() => {
    const map = new Map<string, Evaluation[]>();
    for (const c of candidates) {
      map.set(
        c.id,
        (c.evaluations || []).filter((ev) => ev.epreuve?.tour === tour && isCounted(ev)),
      );
    }
    return map;
  }, [candidates, tour]);

  const inputs: GridCandidateInput[] = useMemo(
    () =>
      candidates.map((c) => ({
        candidateId: c.id,
        notes: (evalsByCandidate.get(c.id) || []).map((ev) => ({
          epreuveKey: epreuveKeyOf(ev),
          epreuveName: ev.epreuve?.name || "Épreuve",
          tour: ev.epreuve?.tour ?? null,
          obtained: sumScores(ev.scores),
          maxTotal: Number(ev.epreuve?.maxTotal),
        })),
      })),
    [candidates, evalsByCandidate],
  );

  const allColumns = useMemo(() => listColumns(inputs), [inputs]);
  const columns = allColumns.filter((col) => !excluded.has(col.key));
  const keys = columns.map((col) => col.key);
  const keySet = useMemo(() => new Set(keys), [keys.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => buildRows(inputs, keySet), [inputs, keySet]);
  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
  const nameOf = (id: string) => {
    const c = byId.get(id);
    return c ? `${c.lastName} ${c.firstName}` : id;
  };

  // Le tri porte sur une épreuve décochée : retour à la moyenne.
  const sortBy = sort.by !== "average" && sort.by !== "name" && !keySet.has(sort.by) ? "average" : sort.by;
  const sorted = sortRows(rows, sortBy, sort.dir, nameOf);

  const groups: [string, GridRow[]][] = useMemo(() => {
    if (!prefs.groupByPole) return [["", sorted]];
    const map = new Map<string, GridRow[]>();
    for (const r of sorted) {
      const c = byId.get(r.candidateId);
      const pole = c ? getFirstPole(c) : "Non renseigne";
      map.set(pole, [...(map.get(pole) || []), r]);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === "Non renseigne") return 1;
      if (b === "Non renseigne") return -1;
      return a.localeCompare(b, "fr");
    });
  }, [prefs.groupByPole, sorted, byId, getFirstPole]);

  const globalStats = columnStats(rows, keys);
  const globalAverage = averageStats(rows);
  const showDetails = prefs.showComments || prefs.showCriteria;
  const colCount = keys.length + 4;

  const toggleSort = (by: GridSortKey) =>
    setSort((prev) =>
      prev.by === by
        ? { by, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { by, dir: by === "name" ? "asc" : "desc" },
    );

  const SortIcon = ({ by }: { by: GridSortKey }) =>
    sortBy !== by ? (
      <ArrowUpDown size={11} className="text-gray-300 shrink-0" />
    ) : sort.dir === "desc" ? (
      <ArrowDown size={11} className="text-blue-600 shrink-0" />
    ) : (
      <ArrowUp size={11} className="text-blue-600 shrink-0" />
    );

  const toggleColumn = (key: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (candidates.length === 0) {
    return (
      <div className="bg-white rounded-xl border p-12 text-center text-gray-400">Aucun candidat pour ce tour.</div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Réglages */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Épreuves du tour {tour}</p>
            {allColumns.length > 1 && (
              <div className="flex items-center gap-2 text-xs">
                <button type="button" className="text-blue-600 hover:underline" onClick={() => setExcluded(new Set())}>
                  Toutes
                </button>
                <span className="text-gray-300">·</span>
                <button
                  type="button"
                  className="text-blue-600 hover:underline"
                  onClick={() => setExcluded(new Set(allColumns.map((c) => c.key)))}
                >
                  Aucune
                </button>
              </div>
            )}
          </div>
          {allColumns.length === 0 ? (
            <p className="text-sm text-gray-400">Aucune note saisie sur ce tour pour l&apos;instant.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {allColumns.map((col) => {
                const on = !excluded.has(col.key);
                return (
                  <button
                    key={col.key}
                    type="button"
                    onClick={() => toggleColumn(col.key)}
                    aria-pressed={on}
                    className={`flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-lg text-sm border transition-colors ${
                      on
                        ? "bg-blue-50 border-blue-300 text-blue-700 font-medium"
                        : "bg-white border-gray-200 text-gray-400 hover:text-gray-600"
                    }`}
                  >
                    <input type="checkbox" readOnly checked={on} tabIndex={-1} className="pointer-events-none rounded border-gray-300 text-blue-600 w-3.5 h-3.5" />
                    {col.name}
                    <span className="text-[10px] text-gray-400 font-normal">/{col.maxTotal}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-3 border-t border-gray-100">
          <Toggle checked={prefs.groupByPole} onChange={(v) => updatePrefs({ groupByPole: v })} label="Regrouper par pôle (1er vœu)" />
          <Toggle checked={prefs.showCriteria} onChange={(v) => updatePrefs({ showCriteria: v })} label="Barèmes et critères" />
          <Toggle checked={prefs.showComments} onChange={(v) => updatePrefs({ showComments: v })} label="Appréciations" />
          <label className="flex items-center gap-2 text-sm text-gray-600 w-full sm:w-auto sm:ml-auto min-w-0">
            <span className="whitespace-nowrap">Trier par</span>
            <select
              value={`${sortBy}|${sort.dir}`}
              onChange={(e) => {
                const i = e.target.value.lastIndexOf("|");
                setSort({ by: e.target.value.slice(0, i), dir: e.target.value.slice(i + 1) as "asc" | "desc" });
              }}
              className="min-w-0 flex-1 sm:flex-none max-w-full px-2 py-1.5 bg-white border border-gray-300 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="average|desc">Moyenne · meilleures d&apos;abord</option>
              <option value="average|asc">Moyenne · moins bonnes d&apos;abord</option>
              <option value="name|asc">Nom (A → Z)</option>
              {columns.map((col) => (
                <Fragment key={col.key}>
                  <option value={`${col.key}|desc`}>{col.name} · meilleures d&apos;abord</option>
                  <option value={`${col.key}|asc`}>{col.name} · moins bonnes d&apos;abord</option>
                </Fragment>
              ))}
            </select>
          </label>
        </div>
        {prefs.showComments && !isAdmin && (
          <p className="text-xs text-gray-400">Seules vos propres appréciations vous sont visibles ; celles des autres examinateurs sont réservées aux admins.</p>
        )}
      </div>

      {/* Tableau */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="scroll-x">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2.5 w-10 text-center">#</th>
                <th className="px-3 py-2.5 sticky left-0 bg-gray-50 z-10 min-w-[180px]">
                  <button type="button" onClick={() => toggleSort("name")} className="flex items-center gap-1 uppercase">
                    Candidat <SortIcon by="name" />
                  </button>
                </th>
                {columns.map((col) => (
                  <th key={col.key} className="px-3 py-2.5 text-center min-w-[110px]">
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className="inline-flex items-center gap-1 uppercase"
                      title={`Barème /${col.maxTotal} · coefficient ${formatCoef(col.coef)} dans la moyenne`}
                    >
                      <span className="normal-case">{col.name}</span> <SortIcon by={col.key} />
                    </button>
                    {prefs.showCriteria && (
                      <span className="block text-[10px] font-normal normal-case text-gray-400">
                        /{col.maxTotal} · coef {formatCoef(col.coef)}
                      </span>
                    )}
                  </th>
                ))}
                <th className="px-3 py-2.5 text-center min-w-[100px]">
                  <button
                    type="button"
                    onClick={() => toggleSort("average")}
                    className="inline-flex items-center gap-1 uppercase"
                    title="Moyenne pondérée par barème des épreuves cochées"
                  >
                    Moyenne <SortIcon by="average" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-center">Décision</th>
              </tr>
              {/* Moyenne de chaque épreuve sur tous les candidats affichés */}
              <tr className="bg-blue-50/50 border-t border-gray-100">
                <td className="px-3 py-2" />
                <td className="px-3 py-2 sticky left-0 bg-blue-50 z-10 text-xs font-semibold text-blue-700 normal-case">
                  Moyenne de l&apos;épreuve
                </td>
                {columns.map((col) => (
                  <td key={col.key} className="px-3 py-2 text-center">
                    <StatsCell s={globalStats[col.key]} />
                  </td>
                ))}
                <td className="px-3 py-2 text-center">
                  <StatsCell s={globalAverage} strong />
                </td>
                <td className="px-3 py-2" />
              </tr>
            </thead>
            {groups.map(([pole, groupRows]) => {
              const poleStats = pole ? columnStats(groupRows, keys) : null;
              const poleAverage = pole ? averageStats(groupRows) : null;
              return (
                <tbody key={pole || "all"} className="divide-y">
                  {pole && (
                    <tr className="bg-gray-50 border-t-2 border-gray-200">
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2 sticky left-0 bg-gray-50 z-10">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: poleColor(pole) }} />
                          <span className="font-semibold text-gray-900">{poleLabel(pole)}</span>
                          <span className="text-xs text-gray-400">{groupRows.length}</span>
                        </div>
                      </td>
                      {columns.map((col) => (
                        <td key={col.key} className="px-3 py-2 text-center text-xs">
                          <StatsCell s={poleStats?.[col.key]} />
                        </td>
                      ))}
                      <td className="px-3 py-2 text-center text-xs">
                        <StatsCell s={poleAverage} strong />
                      </td>
                      <td className="px-3 py-2" />
                    </tr>
                  )}
                  {groupRows.map((r, i) => {
                    const c = byId.get(r.candidateId);
                    if (!c) return null;
                    // Fiches de détail dans l'ordre des colonnes.
                    const evals = (evalsByCandidate.get(c.id) || [])
                      .filter((ev) => keySet.has(epreuveKeyOf(ev)))
                      .sort((a, b) => keys.indexOf(epreuveKeyOf(a)) - keys.indexOf(epreuveKeyOf(b)));
                    return (
                      <Fragment key={c.id}>
                        <tr className="hover:bg-gray-50">
                          <td className="px-3 py-2.5 text-center text-xs text-gray-400">{i + 1}</td>
                          <td className="px-3 py-2.5 sticky left-0 bg-white z-10">
                            <a href={`/dashboard/candidates/${c.id}`} className="font-medium text-gray-900 hover:text-blue-600">
                              {c.firstName} {c.lastName}
                            </a>
                            {!prefs.groupByPole && (
                              <span className="block text-[11px] text-gray-400">{poleLabel(getFirstPole(c))}</span>
                            )}
                          </td>
                          {columns.map((col) => {
                            const cell = r.cells[col.key];
                            const colAvg = globalStats[col.key]?.average;
                            const gap = cell && colAvg !== undefined ? Math.round((cell.scoreOn20 - colAvg) * 10) / 10 : null;
                            return (
                              <td
                                key={col.key}
                                className="px-3 py-2.5 text-center"
                                title={
                                  cell
                                    ? `${cell.count} note${cell.count > 1 ? "s" : ""} · ${gap !== null && gap >= 0 ? "+" : ""}${gap} par rapport à la moyenne de l'épreuve`
                                    : "Pas de note"
                                }
                              >
                                {cell ? (
                                  <span className={`font-semibold ${scoreTone(cell.scoreOn20)}`}>
                                    {cell.scoreOn20}
                                    {cell.count > 1 && <sup className="ml-0.5 text-[9px] font-normal text-gray-400">×{cell.count}</sup>}
                                  </span>
                                ) : (
                                  <span className="text-gray-300">—</span>
                                )}
                              </td>
                            );
                          })}
                          <td className="px-3 py-2.5 text-center">
                            {r.average !== null ? (
                              <span className={`font-bold ${scoreTone(r.average)}`}>
                                {r.average}
                                <span className="text-xs font-normal text-gray-400"> /20</span>
                              </span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex justify-center">{renderDecision(c)}</div>
                          </td>
                        </tr>
                        {showDetails && evals.length > 0 && (
                          <tr className="bg-gray-50/60">
                            <td />
                            <td colSpan={colCount - 1} className="px-3 pb-3 pt-1">
                              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                                {evals.map((ev) => {
                                  const max = Number(ev.epreuve?.maxTotal);
                                  const note = max > 0 ? toTwenty(sumScores(ev.scores), max) : null;
                                  const scores =
                                    ev.scores && typeof ev.scores === "object" ? (ev.scores as Record<string, unknown>) : null;
                                  return (
                                    <div key={ev.id} className="bg-white border border-gray-200 rounded-lg p-2.5">
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="text-xs font-semibold text-gray-700 truncate">{ev.epreuve?.name}</span>
                                        {note !== null && (
                                          <span className={`text-xs font-bold ${scoreTone(note)}`}>{note}/20</span>
                                        )}
                                      </div>
                                      <p className="text-[11px] text-gray-400 mb-1">Par {examinerLabel(ev)}</p>
                                      {prefs.showCriteria && (
                                        <CriteriaScores
                                          questions={ev.epreuve?.id ? questionsByEpreuve[ev.epreuve.id] : undefined}
                                          scores={scores}
                                        />
                                      )}
                                      {prefs.showComments &&
                                        (ev.comment ? (
                                          <p className="text-sm text-gray-600 mt-1 whitespace-pre-line">{ev.comment}</p>
                                        ) : (
                                          <p className="text-xs text-gray-300 italic mt-1">Pas d&apos;appréciation visible</p>
                                        ))}
                                    </div>
                                  );
                                })}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              );
            })}
          </table>
        </div>
        <p className="px-4 py-2.5 border-t text-[11px] text-gray-400">
          Notes /20. Une case = moyenne des examinateurs du candidat sur l&apos;épreuve (×2 : deux notes). La moyenne
          du candidat pèse chaque épreuve cochée selon son barème ; la moyenne d&apos;une épreuve donne le même poids à
          chaque candidat noté. Sous chaque moyenne : la note la plus basse et la plus haute.
        </p>
      </div>
    </div>
  );
}
