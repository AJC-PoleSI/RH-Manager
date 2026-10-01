"use client";

/**
 * TourOpeningsPanel — bouton « Générer le Tour N ».
 *
 * Crée les ouvertures de salles de TOUTES les épreuves d'un tour à partir des
 * dispos saisies une seule fois par les membres, en arbitrant qui tient quoi
 * à chaque tranche (cf. lib/tour-generator.ts) :
 *   - une épreuve de PÔLE ne compte que les membres de son pôle et vise ses
 *     propres candidats (admis au tour précédent ayant demandé ce pôle) ;
 *   - une épreuve ouverte à tous (Business Game) prend les membres encore
 *     libres ;
 *   - un membre n'est jamais compté deux fois au même horaire, une salle
 *     n'est jamais donnée à deux épreuves en même temps ;
 *   - priorité à l'épreuve la plus chargée par personne, recalculée.
 *
 * Les entrées (attendus, viviers, réservations existantes) viennent de
 * GET /api/tour-settings/[tour]/generation-inputs ; les dispos de /api/availability/all.
 *
 * Flux volontairement séparé de RoomOpeningsGrid : « générer pour tout le
 * tour » écrit dans des épreuves qu'on n'a pas sous les yeux. Une relecture
 * (récapitulatif par épreuve + détail des plages) est donc obligatoire avant
 * tout enregistrement — jamais d'écriture silencieuse. Relancer le bouton
 * n'ajoute que le manque et ne supprime jamais rien.
 *
 * Spec : docs/superpowers/specs/2026-10-02-epreuves-de-pole-tour3-design.md
 */

import { useEffect, useMemo, useState } from "react";
import { addDays, format, startOfWeek } from "date-fns";
import { fr } from "date-fns/locale";
import { ChevronRight, Loader2, Sparkles, AlertTriangle } from "lucide-react";
import api from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { estimateSlotsNeeded } from "@/lib/slot-estimator";
import {
  generateTourSlots,
  SHORTFALL_LABELS,
  type GeneratorEpreuve,
  type GeneratorDay,
  type ShortfallReason,
} from "@/lib/tour-generator";
import { hhmmToMinutes, minutesToHHMM, formatDuration, mergeIntervals, type Band } from "@/lib/time-bands";
import { localYmd, MERGE_TOLERANCE_MIN } from "@/lib/availability-bands";

interface TourEpreuveInfo {
  id: string;
  name: string;
  /** Bornes de la période de l'épreuve, pour préremplir la période du panneau. */
  dateDebut?: string | null;
  dateFin?: string | null;
}

interface Props {
  tour: string;
  epreuves: TourEpreuveInfo[];
  onSaved?: () => void;
}

interface InputsEpreuve {
  id: string;
  name: string;
  isGroupEpreuve: boolean;
  isPoleTest: boolean;
  pole: string | null;
  poleKnown: boolean;
  durationMinutes: number;
  roulementMinutes: number;
  minEvaluatorsPerSalle: number;
  groupSize: number | null;
  minCandidates: number | null;
  dateDebut: string | null;
  dateFin: string | null;
  heureDebutJournee: string | null;
  heureFinJournee: string | null;
  expectedCandidates: number;
  existingSlots: number;
  eligibleMemberIds: string[];
}

interface Inputs {
  tour: number;
  margePct: number;
  rooms: string[];
  knownPoles: string[];
  epreuves: InputsEpreuve[];
  busy: { memberId: string; date: string; startTime: string; endTime: string }[];
  roomsTaken: { room: string; date: string; startTime: string; endTime: string }[];
}

interface RecapRow {
  epreuveId: string;
  name: string;
  pole: string | null;
  poleKnown: boolean;
  expected: number;
  target: number;
  existing: number;
  proposed: number;
  remaining: number;
  reason: ShortfallReason;
  eligible: number;
}

/** Garde-fou : au-delà, le chargement des dispos devient lourd pour rien. */
const MAX_PERIOD_DAYS = 60;

function weekdaysBetween(start: string, end: string): Date[] {
  const out: Date[] = [];
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  let cur = new Date(sy, sm - 1, sd, 12);
  const last = new Date(ey, em - 1, ed, 12);
  while (cur <= last && out.length < MAX_PERIOD_DAYS) {
    const dow = cur.getDay();
    if (dow >= 1 && dow <= 5) out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

export default function TourOpeningsPanel({ tour, epreuves, onSaved }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [inputs, setInputs] = useState<Inputs | null>(null);
  const [staffRows, setStaffRows] = useState<any[]>([]);
  const [period, setPeriod] = useState<{ start: string; end: string } | null>(null);
  const [recap, setRecap] = useState<RecapRow[] | null>(null);
  const [preview, setPreview] = useState<Record<string, Band[]> | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const epreuvesKey = epreuves.map((e) => e.id).join(",");

  // Période par défaut : du début de la première épreuve à la fin de la
  // dernière ; sinon la semaine courante. Calculée une fois à l'ouverture,
  // ensuite l'admin la modifie librement.
  useEffect(() => {
    if (!open || period) return;
    const starts = epreuves.map((e) => e.dateDebut).filter((d): d is string => !!d).sort();
    const ends = epreuves.map((e) => e.dateFin).filter((d): d is string => !!d).sort();
    if (starts.length) {
      const start = starts[0].slice(0, 10);
      const end = (ends.length ? ends[ends.length - 1] : starts[starts.length - 1]).slice(0, 10);
      setPeriod({ start, end: end < start ? start : end });
      return;
    }
    const monday = startOfWeek(new Date(), { weekStartsOn: 1 });
    setPeriod({ start: localYmd(monday), end: localYmd(addDays(monday, 4)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, epreuvesKey]);

  const days = useMemo(
    () => (period ? weekdaysBetween(period.start, period.end) : []),
    [period],
  );
  const dayKeys = useMemo(() => days.map(localYmd), [days]);

  // Chargement des entrées + dispos sur la période.
  useEffect(() => {
    if (!open || !period) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setPreview(null);
      setRecap(null);
      setWarnings([]);
      try {
        const noCache = { headers: { "Cache-Control": "no-store" }, params: { t: Date.now() } };
        const [inputsRes, staffRes] = await Promise.all([
          api.get(`/tour-settings/${tour}/generation-inputs`, {
            ...noCache,
            params: { ...noCache.params, start: period.start, end: period.end },
          }),
          api
            .get("/availability/all", {
              ...noCache,
              params: { ...noCache.params, start: period.start, end: period.end },
            })
            .catch(() => ({ data: [] as any[] })),
        ]);
        if (cancelled) return;
        setInputs(inputsRes.data as Inputs);
        setStaffRows(Array.isArray(staffRes.data) ? staffRes.data : []);
      } catch (e: any) {
        if (!cancelled) {
          setInputs(null);
          toast(e?.response?.data?.error || "Impossible de charger les données du tour", "error");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tour, period?.start, period?.end]);

  /** Cible de créneaux d'une épreuve = estimation − déjà existants. */
  const targetOf = (e: InputsEpreuve, margePct: number) => {
    const est = estimateSlotsNeeded({
      candidatsAttendus: e.expectedCandidates,
      margePct,
      isGroupEpreuve: e.isGroupEpreuve,
      groupSize: e.groupSize,
      minCandidates: e.minCandidates,
    });
    return est.applicable ? Math.max(0, est.min - e.existingSlots) : 0;
  };

  const generate = () => {
    if (!inputs || !period) return;
    setWarnings([]);

    // Dispos fusionnées par (jour, membre) — même règle que la courbe de
    // capacité : les trous de 5-10 min sont du roulement, pas des absences.
    const byDayMember = new Map<string, Map<string, { start: number; end: number }[]>>();
    for (const r of staffRows) {
      if (!r?.date || !r.start_time || !r.end_time) continue;
      const key = String(r.date).slice(0, 10);
      const memberId = String(r.member_id ?? r.member?.id ?? r.id);
      const perMember = byDayMember.get(key) ?? new Map();
      const list = perMember.get(memberId) ?? [];
      list.push({ start: hhmmToMinutes(String(r.start_time)), end: hhmmToMinutes(String(r.end_time)) });
      perMember.set(memberId, list);
      byDayMember.set(key, perMember);
    }

    const genDays: GeneratorDay[] = days.map((_, i) => {
      const key = dayKeys[i];
      const windows: GeneratorDay["windows"] = [];
      byDayMember.get(key)?.forEach((intervals, memberId) => {
        for (const iv of mergeIntervals(intervals, MERGE_TOLERANCE_MIN)) {
          windows.push({ memberId, startMin: iv.start, endMin: iv.end });
        }
      });
      return {
        dayIndex: i,
        windows,
        busy: inputs.busy
          .filter((b) => b.date === key)
          .map((b) => ({ memberId: b.memberId, startMin: hhmmToMinutes(b.startTime), endMin: hhmmToMinutes(b.endTime) })),
        roomsTaken: inputs.roomsTaken
          .filter((r) => r.date === key)
          .map((r) => ({ room: r.room, startMin: hhmmToMinutes(r.startTime), endMin: hhmmToMinutes(r.endTime) })),
      };
    });

    const genEpreuves: GeneratorEpreuve[] = inputs.epreuves.map((e) => {
      // Une date de fin ANTÉRIEURE au début (saisie erronée, vu en prod sur le
      // Business Game T3) ne doit pas vider la période : on l'ignore.
      const dateFin = e.dateFin && e.dateDebut && e.dateFin < e.dateDebut ? null : e.dateFin;
      const inPeriod = dayKeys
        .map((k, i) => ({ k, i }))
        .filter(({ k }) => (!e.dateDebut || k >= e.dateDebut) && (!dateFin || k <= dateFin))
        .map(({ i }) => i);
      return {
        epreuveId: e.id,
        name: e.name,
        isGroupEpreuve: e.isGroupEpreuve,
        evaluatorsPerRoom: e.minEvaluatorsPerSalle,
        slotSpanMin: e.durationMinutes + e.roulementMinutes,
        targetSlots: targetOf(e, inputs.margePct),
        eligibleMembers: e.eligibleMemberIds,
        dayIndexes: e.dateDebut || dateFin ? inPeriod : null,
        dayStartMin: e.heureDebutJournee ? hhmmToMinutes(e.heureDebutJournee) : null,
        dayEndMin: e.heureFinJournee ? hhmmToMinutes(e.heureFinJournee) : null,
      };
    });

    const result = generateTourSlots({ days: genDays, epreuves: genEpreuves, rooms: inputs.rooms });

    const rows: RecapRow[] = inputs.epreuves.map((e) => {
      const target = targetOf(e, inputs.margePct);
      const bands = result.bandsByEpreuve[e.id] || [];
      const span = e.durationMinutes + e.roulementMinutes;
      const proposed = bands.reduce((s, b) => s + Math.floor((b.endMin - b.startMin) / span), 0);
      return {
        epreuveId: e.id,
        name: e.name.trim(),
        pole: e.pole,
        poleKnown: e.poleKnown,
        expected: e.expectedCandidates,
        target,
        existing: e.existingSlots,
        proposed,
        remaining: result.remainingByEpreuve[e.id] ?? 0,
        reason: result.reasonByEpreuve[e.id] ?? "ok",
        eligible: e.eligibleMemberIds.length,
      };
    });
    setRecap(rows);

    const warn: string[] = [];
    for (const r of rows) {
      if (!r.poleKnown) {
        warn.push(
          `${r.name} : pôle « ${r.pole} » inconnu — aucun membre ne porte ce pôle (pôles connus : ${inputs.knownPoles.join(", ") || "aucun"}).`,
        );
      } else if (r.remaining > 0 && r.target > 0) {
        warn.push(`${r.name} : il manquera encore ${r.remaining} créneau(x) — ${SHORTFALL_LABELS[r.reason] || "cause inconnue"}.`);
      }
    }
    setWarnings(warn);

    const totalBands = Object.values(result.bandsByEpreuve).reduce((s, b) => s + b.length, 0);
    if (totalBands === 0) {
      setPreview(null);
      if (rows.every((r) => r.target === 0)) {
        toast("Toutes les épreuves de ce tour ont déjà assez de créneaux.", "success");
      } else {
        toast("Aucune ouverture possible sur cette période avec les dispos actuelles.", "error");
      }
      return;
    }
    setPreview(result.bandsByEpreuve);
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
            const name = inputs?.epreuves.find((x) => x.id === epreuveId)?.name ?? epreuveId;
            problems.push(`${name.trim()} · ${b.laneId} : ${e?.response?.data?.error || "échec"}`);
          }
        }
      }
      // Global (sans epreuveId) : ce panneau crée des créneaux sur PLUSIEURS
      // épreuves qui se partagent le même pool d'examinateurs — un dispatch
      // scopé à une seule épreuve ne verrait pas les nouvelles ouvertures
      // des autres.
      try {
        await api.post("/dispatch/run", {});
      } catch (e: any) {
        console.error("Dispatch after tour openings save failed:", e);
      }

      setPreview(null);
      setRecap(null);
      // Recharger l'existant : une relance doit voir ce qui vient d'être créé.
      setPeriod((p) => (p ? { ...p } : p));
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

  if (epreuves.length === 0) return null;

  const previewRows = preview
    ? Object.entries(preview).flatMap(([epreuveId, bands]) =>
        bands.map((b) => ({
          epreuve: inputs?.epreuves.find((e) => e.id === epreuveId)?.name ?? epreuveId,
          jour: days[b.dayIndex] ? format(days[b.dayIndex], "EEE d MMM", { locale: fr }) : dayKeys[b.dayIndex],
          salle: b.laneId,
          horaire: `${minutesToHHMM(b.startMin)}–${minutesToHHMM(b.endMin)}`,
          duree: b.endMin - b.startMin,
        })),
      )
    : [];

  const poleCount = inputs?.epreuves.filter((e) => e.isPoleTest).length ?? 0;
  const periodTooLong =
    !!period && weekdaysBetween(period.start, period.end).length >= MAX_PERIOD_DAYS;

  return (
    <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-indigo-900">
          <Sparkles className="h-4 w-4" />
          Générer le Tour {tour}
          {inputs ? ` — ${inputs.epreuves.length} épreuve${inputs.epreuves.length > 1 ? "s" : ""}${poleCount ? ` dont ${poleCount} de pôle` : ""}` : ""}
        </span>
        <ChevronRight className={`h-4 w-4 text-indigo-500 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-indigo-800">
            Crée les créneaux de toutes les épreuves du tour à partir des dispos
            des membres. Une épreuve de pôle ne mobilise que les membres de son
            pôle ; un membre n&apos;est jamais compté deux fois au même horaire ;
            l&apos;épreuve la plus chargée par personne est servie en premier.
            Relancer n&apos;ajoute que le manque et ne supprime jamais rien.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-gray-700">
              Du
              <input
                type="date"
                value={period?.start ?? ""}
                onChange={(e) => setPeriod((p) => ({ start: e.target.value, end: p?.end && p.end >= e.target.value ? p.end : e.target.value }))}
                className="rounded-md border border-indigo-200 bg-white px-2 py-1 text-xs"
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-700">
              au
              <input
                type="date"
                value={period?.end ?? ""}
                min={period?.start}
                onChange={(e) => setPeriod((p) => ({ start: p?.start ?? e.target.value, end: e.target.value }))}
                className="rounded-md border border-indigo-200 bg-white px-2 py-1 text-xs"
              />
            </label>
            <span className="text-xs text-gray-500">
              {days.length} jour{days.length > 1 ? "s" : ""} ouvré{days.length > 1 ? "s" : ""}
              {periodTooLong ? ` (limité à ${MAX_PERIOD_DAYS})` : ""}
            </span>
            <Button size="sm" onClick={generate} disabled={loading || !inputs || days.length === 0}>
              {loading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-2 h-3.5 w-3.5" />}
              Générer
            </Button>
          </div>

          {!loading && inputs && !recap && (
            <div className="grid grid-cols-1 gap-2 text-xs text-gray-600 sm:grid-cols-2 lg:grid-cols-3">
              {inputs.epreuves.map((e) => {
                const target = targetOf(e, inputs.margePct);
                return (
                  <span key={e.id} className="rounded-md bg-white px-2 py-1">
                    {e.name.trim()}
                    {e.isPoleTest && e.pole ? <span className="ml-1 text-indigo-700">· {e.pole}</span> : null}
                    {" — "}
                    {e.expectedCandidates} attendu{e.expectedCandidates > 1 ? "s" : ""},{" "}
                    {e.eligibleMemberIds.length} membre{e.eligibleMemberIds.length > 1 ? "s" : ""},{" "}
                    {target > 0 ? (
                      <strong className="text-amber-700">{target} créneau{target > 1 ? "x" : ""} à créer</strong>
                    ) : (
                      <strong className="text-emerald-700">comblé</strong>
                    )}
                  </span>
                );
              })}
            </div>
          )}

          {recap && (
            <div className="rounded-lg border border-indigo-200 bg-white p-3">
              <div className="mb-2 text-xs font-medium text-gray-700">Récapitulatif par épreuve</div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-400">
                    <th className="pb-1 pr-3">Épreuve</th>
                    <th className="pb-1 pr-3 text-right">Attendus</th>
                    <th className="pb-1 pr-3 text-right">Membres</th>
                    <th className="pb-1 pr-3 text-right">Existants</th>
                    <th className="pb-1 pr-3 text-right">À créer</th>
                    <th className="pb-1 pr-3 text-right">Proposés</th>
                    <th className="pb-1 pr-3 text-right">Manque</th>
                    <th className="pb-1">Cause</th>
                  </tr>
                </thead>
                <tbody>
                  {recap.map((r) => (
                    <tr key={r.epreuveId} className={`border-t border-gray-100 ${!r.poleKnown ? "bg-red-50" : r.remaining > 0 ? "bg-amber-50" : ""}`}>
                      <td className="py-1 pr-3">
                        {r.name}
                        {r.pole ? <span className="ml-1 text-indigo-700">· {r.pole}</span> : null}
                      </td>
                      <td className="py-1 pr-3 text-right tabular-nums">{r.expected}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{r.eligible}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{r.existing}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{r.target}</td>
                      <td className="py-1 pr-3 text-right tabular-nums font-semibold">{r.proposed}</td>
                      <td className={`py-1 pr-3 text-right tabular-nums ${r.remaining > 0 ? "text-amber-700 font-semibold" : "text-emerald-700"}`}>
                        {r.remaining}
                      </td>
                      <td className="py-1 text-gray-600">
                        {!r.poleKnown ? "pôle inconnu" : r.remaining > 0 ? SHORTFALL_LABELS[r.reason] : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
