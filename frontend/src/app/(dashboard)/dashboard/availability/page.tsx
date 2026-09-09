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
} from "lucide-react";
import api from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import TimeBandGrid, { type Overlay } from "@/components/planning/TimeBandGrid";
import {
  rowsToBands,
  bandsToRows,
  localYmd,
  type AvailabilityRow,
} from "@/lib/availability-bands";
import { formatDuration, hhmmToMinutes, type Band } from "@/lib/time-bands";

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

  const [weekOffset, setWeekOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saisieOuverte, setSaisieOuverte] = useState(true);

  const [bands, setBands] = useState<Band[]>([]);
  const [overlays, setOverlays] = useState<Overlay[]>([]);
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
      setOverlays(
        slots
          .map((s: any): Overlay | null => {
            const idx = dayIndexOf.get(String(s.date).slice(0, 10));
            if (idx === undefined || !s.start_time || !s.end_time) return null;
            return {
              id: s.id,
              dayIndex: idx,
              laneId: "",
              startMin: hhmmToMinutes(String(s.start_time)),
              endMin: hhmmToMinutes(String(s.end_time)),
              label: s.epreuve?.name?.trim() || "Épreuve",
              sublabel: s.room ? `salle ${s.room}` : undefined,
              color: colorFor(s.epreuve?.id || s.id),
            };
          })
          .filter(Boolean) as Overlay[],
      );

      setDirty(false);
    } catch (e) {
      console.error(e);
      toast("Impossible de charger vos disponibilités", "error");
    } finally {
      setLoading(false);
    }
  }, [days, toast]);

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
            cette semaine
          </span>
        )}
        {dirty && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            modifications non enregistrées
          </span>
        )}
      </div>

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
          readOnly={!saisieOuverte}
        />
      )}
    </div>
  );
}
