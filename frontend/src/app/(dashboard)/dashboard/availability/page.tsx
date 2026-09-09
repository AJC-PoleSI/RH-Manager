"use client";

/**
 * Saisie des disponibilités d'un examinateur — grille à bandes.
 *
 * Remplace la saisie créneau par créneau : on trace sa présence au glissement
 * sur une grille 8h00–20h30, du lundi au vendredi.
 *
 * Les disponibilités déjà enregistrées sont converties à la LECTURE (fusion
 * des cases contiguës, cf. availability-bands.ts). Rien n'est réécrit tant
 * que le membre n'enregistre pas : ouvrir cette page ne modifie pas la base.
 *
 * Spec : docs/superpowers/specs/2026-09-09-refonte-creneaux-bandes-design.md
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, format, startOfWeek } from "date-fns";
import { fr } from "date-fns/locale";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Save,
  Info,
  CalendarCheck,
  Users,
  X,
} from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import TimeBandGrid, { type Overlay } from "@/components/planning/TimeBandGrid";
import {
  rowsToBands,
  bandsToRows,
  localYmd,
  type AvailabilityRow,
} from "@/lib/availability-bands";
import {
  formatDuration,
  hhmmToMinutes,
  minutesToHHMM,
  type Band,
} from "@/lib/time-bands";

const STATUS_LABELS: Record<string, string> = {
  draft: "Pas encore publié",
  open: "En attente de complément de jury",
  ready: "Jury complet — en attente de publication",
  published: "Publié aux candidats",
  full: "Complet",
  closed: "Clôturé",
};

/** Détail d'une affectation, tenu à part de l'Overlay générique du grid. */
interface SlotDetail {
  id: string;
  epreuveName: string;
  date: string;
  startMin: number;
  endMin: number;
  room?: string;
  status?: string;
  candidateNames: string[];
  coExaminerNames: string[];
}

function fullName(p: { first_name?: string; last_name?: string; email?: string }) {
  const name = `${p.first_name || ""} ${p.last_name || ""}`.trim();
  return name || p.email || "";
}

/** Palette stable par épreuve, pour que les affectations se reconnaissent. */
const EPREUVE_COLORS = [
  "#2563eb",
  "#7c3aed",
  "#0891b2",
  "#ea580c",
  "#16a34a",
  "#db2777",
];
function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return EPREUVE_COLORS[h % EPREUVE_COLORS.length];
}

export default function AvailabilityPage() {
  const { toast } = useToast();
  const { user } = useAuth();

  const [weekOffset, setWeekOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saisieOuverte, setSaisieOuverte] = useState(true);

  const [bands, setBands] = useState<Band[]>([]);
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [slotDetails, setSlotDetails] = useState<Map<string, SlotDetail>>(new Map());
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  /** Nombre de lignes en base avant fusion, pour expliquer le regroupement. */
  const [rowCount, setRowCount] = useState(0);

  const days = useMemo(() => {
    const monday = addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), weekOffset * 7);
    return Array.from({ length: 5 }, (_, i) => addDays(monday, i));
  }, [weekOffset]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const noCache = {
        headers: { "Cache-Control": "no-store" },
        params: { t: Date.now() },
      };

      const startStr = localYmd(days[0]);
      const endStr = localYmd(days[4]);

      const [settingsRes, availRes, slotsRes] = await Promise.all([
        api.get("/settings", noCache),
        api.get("/availability", {
          ...noCache,
          params: { ...noCache.params, start: startStr, end: endStr },
        }),
        // Les affectations sont un confort d'affichage : si l'appel échoue,
        // la saisie doit rester possible.
        api.get("/slots/my-slots", noCache).catch(() => ({ data: [] })),
      ]);

      const saisie = settingsRes.data?.saisie_dispos_ouverte;
      setSaisieOuverte(saisie === undefined || saisie === "true" || saisie === true);

      const rows: AvailabilityRow[] = Array.isArray(availRes.data) ? availRes.data : [];
      setRowCount(rows.length);
      setBands(rowsToBands(rows, days));

      const dayIndexOf = new Map(days.map((d, i) => [localYmd(d), i]));
      const slots = Array.isArray(slotsRes.data) ? slotsRes.data : [];
      const nextOverlays: Overlay[] = [];
      const nextDetails = new Map<string, SlotDetail>();
      for (const s of slots) {
        const idx = dayIndexOf.get(String(s.date).slice(0, 10));
        if (idx === undefined || !s.start_time || !s.end_time) continue;

        const candidateNames = ((s.enrollments || []) as any[])
          .map((e) => fullName(e.candidate || {}))
          .filter(Boolean);
        const coExaminerNames = ((s.members || []) as any[])
          .filter((m) => m.member_id !== user?.id)
          .map((m) => fullName(m.member || {}))
          .filter(Boolean);

        const parts: string[] = [];
        if (s.room) parts.push(`salle ${s.room}`);
        if (candidateNames.length === 1) parts.push(candidateNames[0]);
        else if (candidateNames.length > 1)
          parts.push(`${candidateNames.length} candidats`);

        nextOverlays.push({
          id: s.id,
          dayIndex: idx,
          laneId: "",
          startMin: hhmmToMinutes(String(s.start_time)),
          endMin: hhmmToMinutes(String(s.end_time)),
          label: s.epreuve?.name?.trim() || "Épreuve",
          sublabel: parts.join(" · ") || undefined,
          color: colorFor(s.epreuve?.id || s.id),
        });
        nextDetails.set(s.id, {
          id: s.id,
          epreuveName: s.epreuve?.name?.trim() || "Épreuve",
          date: String(s.date).slice(0, 10),
          startMin: hhmmToMinutes(String(s.start_time)),
          endMin: hhmmToMinutes(String(s.end_time)),
          room: s.room || undefined,
          status: s.status,
          candidateNames,
          coExaminerNames,
        });
      }
      setOverlays(nextOverlays);
      setSlotDetails(nextDetails);

      setDirty(false);
    } catch (e) {
      console.error(e);
      toast("Impossible de charger vos disponibilités", "error");
    } finally {
      setLoading(false);
    }
  }, [days, toast, user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleChange = (next: Band[]) => {
    setBands(next);
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put("/availability", {
        availabilities: bandsToRows(bands, days),
        // On ne remplace QUE les jours affichés : une dispo saisie ailleurs
        // (week-end, autre semaine) ne doit pas disparaître parce qu'on a
        // enregistré cette grille.
        startDate: localYmd(days[0]),
        endDate: localYmd(days[4]),
      });
      toast("Disponibilités enregistrées", "success");
      await load();
    } catch (e: any) {
      console.error(e);
      toast(
        e?.response?.data?.error || "Échec de l'enregistrement",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  const totalMin = bands.reduce((s, b) => s + (b.endMin - b.startMin), 0);
  // Plus de lignes en base que de bandes affichées : la fusion a regroupé des
  // créneaux cochés un par un. On le dit, pour que personne ne croie avoir
  // perdu quelque chose.
  const wasMerged = !dirty && rowCount > bands.length && bands.length > 0;

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mes disponibilités</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Clique et fais glisser pour tracer une plage. Reclique dessus pour
            l&apos;ajuster.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-gray-200 p-0.5">
            <button
              onClick={() => setWeekOffset((w) => w - 1)}
              className="rounded-md p-1.5 text-gray-500 hover:bg-gray-50"
              aria-label="Semaine précédente"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-2 text-sm font-medium text-gray-700">
              {format(days[0], "d MMM", { locale: fr })} –{" "}
              {format(days[4], "d MMM yyyy", { locale: fr })}
            </span>
            <button
              onClick={() => setWeekOffset((w) => w + 1)}
              className="rounded-md p-1.5 text-gray-500 hover:bg-gray-50"
              aria-label="Semaine suivante"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <Button onClick={handleSave} disabled={saving || loading || !saisieOuverte}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Enregistrer
          </Button>
        </div>
      </div>

      {!saisieOuverte && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          La saisie des disponibilités est fermée par l&apos;administrateur.
          Vous pouvez consulter vos plages, mais pas les modifier.
        </div>
      )}

      {wasMerged && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Vos {rowCount} créneaux déjà cochés cette semaine ont été regroupés
            en {bands.length} plage{bands.length > 1 ? "s" : ""} continue
            {bands.length > 1 ? "s" : ""}. Rien n&apos;a été modifié en base —
            vérifiez, ajustez si besoin, puis enregistrez.
          </span>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-4 text-sm text-gray-500">
        <span>
          <strong className="text-gray-900">{bands.length}</strong> plage
          {bands.length > 1 ? "s" : ""} · {formatDuration(totalMin)} au total
        </span>
        {overlays.length > 0 && (
          <span className="flex items-center gap-1.5">
            <CalendarCheck className="h-4 w-4" />
            {overlays.length} affectation{overlays.length > 1 ? "s" : ""} sur
            cette semaine — cliquez sur une affectation pour le détail
          </span>
        )}
        {dirty && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            modifications non enregistrées
          </span>
        )}
      </div>

      {overlays.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-[3px] border-2 border-dashed border-blue-300 bg-blue-50" />
            Disponibilité déclarée
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-[3px] bg-blue-600" />
            Affectation confirmée
          </span>
        </div>
      )}

      {loading ? (
        <div className="flex h-64 items-center justify-center text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <TimeBandGrid
          days={days}
          bands={bands}
          overlays={overlays}
          onChange={handleChange}
          onOverlayClick={(o) => setSelectedSlotId(o.id)}
          readOnly={!saisieOuverte}
        />
      )}

      {selectedSlotId &&
        (() => {
          const d = slotDetails.get(selectedSlotId);
          if (!d) return null;
          const dateLabel = new Date(`${d.date}T12:00:00`).toLocaleDateString(
            "fr-FR",
            { weekday: "long", day: "numeric", month: "long" },
          );
          return (
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
              onClick={() => setSelectedSlotId(null)}
            >
              <div
                className="w-full max-w-sm overflow-hidden rounded-xl bg-white shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3 border-b border-gray-100 p-5">
                  <div>
                    <h3 className="font-semibold text-gray-900">
                      {d.epreuveName}
                    </h3>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {dateLabel} · {minutesToHHMM(d.startMin)}–
                      {minutesToHHMM(d.endMin)}
                      {d.room ? ` · salle ${d.room}` : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedSlotId(null)}
                    className="rounded-lg bg-gray-100 p-1 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="space-y-4 p-5">
                  {d.status && (
                    <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                      {STATUS_LABELS[d.status] || d.status}
                    </span>
                  )}
                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-gray-600">
                      <Users className="h-3.5 w-3.5" />
                      Candidat{d.candidateNames.length > 1 ? "s" : ""} (
                      {d.candidateNames.length})
                    </p>
                    {d.candidateNames.length > 0 ? (
                      <ul className="space-y-1 text-sm text-gray-800">
                        {d.candidateNames.map((n) => (
                          <li key={n}>{n}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-gray-400">
                        Personne inscrit pour l&apos;instant.
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="mb-1.5 text-xs font-semibold text-gray-600">
                      Avec vous dans le jury
                    </p>
                    {d.coExaminerNames.length > 0 ? (
                      <ul className="space-y-1 text-sm text-gray-800">
                        {d.coExaminerNames.map((n) => (
                          <li key={n}>{n}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-gray-400">
                        Vous êtes seul(e) affecté(e) pour l&apos;instant.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}
