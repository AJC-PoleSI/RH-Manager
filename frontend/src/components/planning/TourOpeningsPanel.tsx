"use client";

/**
 * TourOpeningsPanel — arbitre les salles entre les épreuves d'un même tour
 * qui se disputent le même pool d'examinateurs (ex. Business Game + Entretien
 * individuel du Tour 1, tous deux à 100 candidats).
 *
 * Ne s'affiche que si le tour compte AU MOINS DEUX épreuves qui ont besoin de
 * créneaux (individuelle / groupe — pas "commune", qui n'est pas sujette à
 * ouvertures de salles). Sinon le bouton par-épreuve de RoomOpeningsGrid
 * suffit : il n'y a personne avec qui arbitrer.
 *
 * Flux volontairement séparé de RoomOpeningsGrid : « générer pour tout le
 * tour » écrit potentiellement dans des épreuves qu'on n'a pas sous les yeux
 * à l'écran. Une relecture (tableau récapitulatif) est donc obligatoire
 * avant tout enregistrement — jamais d'écriture silencieuse.
 *
 * Spec : docs/superpowers/specs/2026-09-09-refonte-creneaux-bandes-design.md
 */

import { useEffect, useMemo, useState } from "react";
import { addDays, format, startOfWeek } from "date-fns";
import { fr } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Loader2, Sparkles, AlertTriangle } from "lucide-react";
import api from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { estimateSlotsNeeded } from "@/lib/slot-estimator";
import { generateTourOpenings, type TourEpreuveNeed } from "@/lib/tour-openings";
import { hhmmToMinutes, minutesToHHMM, formatDuration, type Band } from "@/lib/time-bands";
import { localYmd, MERGE_TOLERANCE_MIN } from "@/lib/availability-bands";
import { mergeIntervals } from "@/lib/time-bands";

interface TourEpreuveInfo {
  id: string;
  name: string;
  isGroupEpreuve: boolean;
  durationMinutes: number;
  roulementMinutes: number;
  minEvaluatorsPerSalle: number;
  groupSize: number | null;
  minCandidates: number | null;
  /** Ancre la semaine par défaut du panneau sur le début réel de l'épreuve. */
  dateDebut?: string | null;
}

interface Props {
  tour: string;
  epreuves: TourEpreuveInfo[];
  onSaved?: () => void;
}

const FALLBACK_ROOMS = ["205", "217", "219", "235", "238-240", "242-244"];

export default function TourOpeningsPanel({ tour, epreuves, onSaved }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [weekOffset, setWeekOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [capacity, setCapacity] = useState<{ candidatsAttendus: number | null; margePct: number }>({
    candidatsAttendus: null,
    margePct: 25,
  });
  const [needs, setNeeds] = useState<TourEpreuveNeed[]>([]);
  const [preview, setPreview] = useState<Record<string, Band[]> | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const thisMonday = useMemo(() => startOfWeek(new Date(), { weekStartsOn: 1 }), []);
  const epreuvesKey = epreuves.map((e) => e.id).join(",");

  // Ancrage initial : la semaine de la plus proche date_debut parmi les
  // épreuves du tour. Ne se recalcule qu'une fois, à l'ouverture — ensuite
  // l'admin navigue librement sans se faire recentrer sous ses pieds.
  useEffect(() => {
    if (!open || weekOffset !== null) return;
    const anchor = epreuves
      .map((e) => e.dateDebut)
      .filter((d): d is string => !!d)
      .sort()[0];
    if (!anchor) {
      setWeekOffset(0);
      return;
    }
    const [y, m, d] = anchor.slice(0, 10).split("-").map(Number);
    const target = startOfWeek(new Date(y, m - 1, d, 12), { weekStartsOn: 1 });
    setWeekOffset(Math.round((target.getTime() - thisMonday.getTime()) / (7 * 864e5)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, epreuvesKey, thisMonday]);

  const days = useMemo(
    () => Array.from({ length: 5 }, (_, i) => addDays(thisMonday, (weekOffset ?? 0) * 7 + i)),
    [thisMonday, weekOffset],
  );
  const dayKeys = useMemo(() => days.map(localYmd), [days]);

  // Charge l'effectif du tour + le manque de chaque épreuve dès l'ouverture.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setPreview(null);
      try {
        const noCache = { headers: { "Cache-Control": "no-store" }, params: { t: Date.now() } };
        const [capRes, settingsRes] = await Promise.all([
          api.get(`/tour-settings/${tour}`, noCache),
          api.get("/settings", noCache).catch(() => ({ data: {} })),
        ]);
        if (cancelled) return;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- epreuvesKey ci-dessous fixe la dépendance réelle

        const cap = {
          candidatsAttendus: capRes.data?.candidatsAttendus ?? null,
          margePct: capRes.data?.margePct ?? 25,
        };
        setCapacity(cap);

        const declaredRooms = String(settingsRes.data?.rooms || "")
          .split(",")
          .map((r: string) => r.trim())
          .filter(Boolean);
        const roomPool = declaredRooms.length ? declaredRooms : FALLBACK_ROOMS;

        const list: TourEpreuveNeed[] = [];
        for (const ep of epreuves) {
          const openRes = await api
            .get("/openings", { ...noCache, params: { ...noCache.params, epreuveId: ep.id } })
            .catch(() => ({ data: [] as any[] }));
          const openings = Array.isArray(openRes.data) ? openRes.data : [];
          const slotsTotal = openings.reduce((s: number, o: any) => s + (o.slots_total ?? 0), 0);
          const usedRooms = Array.from(new Set(openings.map((o: any) => o.room).filter(Boolean)));
          const rooms = Array.from(new Set([...roomPool, ...usedRooms]));

          const est = estimateSlotsNeeded({
            candidatsAttendus: cap.candidatsAttendus,
            margePct: cap.margePct,
            isGroupEpreuve: ep.isGroupEpreuve,
            groupSize: ep.groupSize,
            minCandidates: ep.minCandidates,
          });
          const target = est.applicable ? Math.max(0, est.min - slotsTotal) : 0;

          list.push({
            epreuveId: ep.id,
            isGroupEpreuve: ep.isGroupEpreuve,
            evaluatorsPerRoom: ep.minEvaluatorsPerSalle,
            slotSpanMin: ep.durationMinutes + ep.roulementMinutes,
            targetSlots: target,
            rooms,
          });
        }
        if (!cancelled) setNeeds(list);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `epreuves` est un tableau recréé à chaque rendu du parent : on dépend
    // de son CONTENU (epreuvesKey), jamais de sa référence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tour, epreuvesKey]);

  const generate = async () => {
    setLoading(true);
    setPreview(null);
    setWarnings([]);
    try {
      const staffRes = await api
        .get("/availability/all", { headers: { "Cache-Control": "no-store" }, params: { t: Date.now() } })
        .catch(() => ({ data: [] as any[] }));
      const rows = Array.isArray(staffRes.data) ? staffRes.data : [];

      // Fusion des dispos cochées en cases (même règle que la courbe « C » :
      // les trous de 5-10 min sont du roulement, pas des absences).
      const byDayMember = new Map<string, Map<string, { start: number; end: number }[]>>();
      for (const r of rows) {
        if (!r?.date || !r.start_time || !r.end_time) continue;
        const key = String(r.date).slice(0, 10);
        const memberId = String(r.member_id ?? r.member?.id ?? r.id);
        const perMember = byDayMember.get(key) ?? new Map();
        const list = perMember.get(memberId) ?? [];
        list.push({ start: hhmmToMinutes(String(r.start_time)), end: hhmmToMinutes(String(r.end_time)) });
        perMember.set(memberId, list);
        byDayMember.set(key, perMember);
      }

      const tourDays = days.map((_, i) => {
        const key = dayKeys[i];
        const windows: { memberId: string; startMin: number; endMin: number }[] = [];
        byDayMember.get(key)?.forEach((intervals, memberId) => {
          for (const iv of mergeIntervals(intervals, MERGE_TOLERANCE_MIN)) {
            windows.push({ memberId, startMin: iv.start, endMin: iv.end });
          }
        });
        return { dayIndex: i, windows };
      });

      const activeNeeds = needs.filter((n) => n.targetSlots > 0);
      if (activeNeeds.length === 0) {
        toast("Toutes les épreuves de ce tour ont déjà assez de créneaux.", "success");
        return;
      }

      const result = generateTourOpenings({ days: tourDays, epreuves: activeNeeds });
      const totalBands = Object.values(result.bandsByEpreuve).reduce((s, b) => s + b.length, 0);
      if (totalBands === 0) {
        toast(
          "Aucun examinateur disponible cette semaine ne permet d'ouvrir de salle pour ce tour. Essayez une autre semaine.",
          "error",
        );
        return;
      }
      setPreview(result.bandsByEpreuve);

      const short = Object.entries(result.remainingByEpreuve)
        .filter(([, n]) => n > 0)
        .map(([id, n]) => {
          const name = epreuves.find((e) => e.id === id)?.name ?? id;
          return `${name.trim()} : il manquera encore ${n} créneau(x)`;
        });
      setWarnings(short);
    } finally {
      setLoading(false);
    }
  };

  const confirmSave = async () => {
    if (!preview) return;
    setSaving(true);
    const problems: string[] = [];
    try {
      for (const [epreuveId, bands] of Object.entries(preview)) {
        for (const b of bands) {
          try {
            await api.post("/openings", {
              epreuveId,
              room: b.laneId,
              dates: [dayKeys[b.dayIndex]],
              startTime: minutesToHHMM(b.startMin),
              endTime: minutesToHHMM(b.endMin),
            });
          } catch (e: any) {
            const name = epreuves.find((x) => x.id === epreuveId)?.name ?? epreuveId;
            problems.push(`${name.trim()} · ${b.laneId} : ${e?.response?.data?.error || "échec"}`);
          }
        }
      }
      setPreview(null);
      onSaved?.();
      if (problems.length) {
        setWarnings(problems);
        toast(`Enregistré avec ${problems.length} avertissement(s)`, "error");
      } else {
        toast("Ouvertures du tour enregistrées", "success");
      }
    } finally {
      setSaving(false);
    }
  };

  if (epreuves.length < 2) return null; // rien à arbitrer seul

  const previewRows = preview
    ? Object.entries(preview).flatMap(([epreuveId, bands]) =>
        bands.map((b) => ({
          epreuve: epreuves.find((e) => e.id === epreuveId)?.name ?? epreuveId,
          jour: format(days[b.dayIndex], "EEE d MMM", { locale: fr }),
          salle: b.laneId,
          horaire: `${minutesToHHMM(b.startMin)}–${minutesToHHMM(b.endMin)}`,
          duree: b.endMin - b.startMin,
        })),
      )
    : [];

  return (
    <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-indigo-900">
          <Sparkles className="h-4 w-4" />
          Tour {tour} — {epreuves.length} épreuves partagent le même effectif
          {capacity.candidatsAttendus ? ` (${capacity.candidatsAttendus} candidats)` : ""}
        </span>
        <ChevronRight className={`h-4 w-4 text-indigo-500 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-indigo-800">
            {epreuves.map((e) => e.name.trim()).join(" · ")} — mêmes candidats,
            même pool d&apos;examinateurs. Chaque épreuve garde SES PROPRES
            salles ; ce panneau décide seulement laquelle a priorité sur les
            examinateurs à chaque créneau (collectif d&apos;abord si
            l&apos;effectif le permet, sinon individuel).
          </p>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 rounded-lg border border-indigo-200 bg-white p-0.5">
              <button onClick={() => setWeekOffset((w) => (w ?? 0) - 1)} className="rounded-md p-1.5 text-gray-500 hover:bg-gray-50">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-2 text-sm font-medium text-gray-700">
                {format(days[0], "d MMM", { locale: fr })} – {format(days[4], "d MMM yyyy", { locale: fr })}
              </span>
              <button onClick={() => setWeekOffset((w) => (w ?? 0) + 1)} className="rounded-md p-1.5 text-gray-500 hover:bg-gray-50">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <Button size="sm" onClick={generate} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-2 h-3.5 w-3.5" />}
              Générer les ouvertures du tour sur cette semaine
            </Button>
          </div>

          {!loading && needs.length > 0 && (
            <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 sm:grid-cols-3">
              {needs.map((n) => (
                <span key={n.epreuveId} className="rounded-md bg-white px-2 py-1">
                  {epreuves.find((e) => e.id === n.epreuveId)?.name?.trim()} —{" "}
                  {n.targetSlots > 0 ? (
                    <strong className="text-amber-700">{n.targetSlots} manquants</strong>
                  ) : (
                    <strong className="text-emerald-700">comblé</strong>
                  )}
                </span>
              ))}
            </div>
          )}

          {warnings.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <div className="mb-1 flex items-center gap-1.5 font-medium">
                <AlertTriangle className="h-3.5 w-3.5" /> À savoir
              </div>
              <ul className="list-inside list-disc space-y-0.5">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {preview && (
            <div className="rounded-lg border border-indigo-200 bg-white p-3">
              <div className="mb-2 text-xs font-medium text-gray-700">
                {previewRows.length} ouverture(s) proposée(s) — relisez avant d&apos;enregistrer :
              </div>
              <div className="max-h-56 overflow-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-400">
                      <th className="pb-1 pr-3">Épreuve</th>
                      <th className="pb-1 pr-3">Jour</th>
                      <th className="pb-1 pr-3">Salle</th>
                      <th className="pb-1">Horaire</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((r, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="py-1 pr-3">{r.epreuve.trim()}</td>
                        <td className="py-1 pr-3">{r.jour}</td>
                        <td className="py-1 pr-3">{r.salle}</td>
                        <td className="py-1 tabular-nums">
                          {r.horaire} ({formatDuration(r.duree)})
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Button size="sm" onClick={confirmSave} disabled={saving}>
                  {saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                  Enregistrer ces {previewRows.length} ouvertures
                </Button>
                <Button size="sm" variant="outline" onClick={() => setPreview(null)} disabled={saving}>
                  Annuler
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
