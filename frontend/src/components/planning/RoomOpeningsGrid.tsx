"use client";

/**
 * RoomOpeningsGrid — ouverture des salles à la souris, pour une épreuve.
 *
 * L'admin trace une bande dans la colonne d'une salle : c'est une
 * `room_opening`, que l'API découpe ensuite en créneaux (sliceOpening) selon
 * la durée et le roulement de l'épreuve.
 *
 * Rien n'est écrit tant qu'on n'a pas cliqué « Enregistrer » : la grille
 * calcule un diff (openings-diff.ts) et n'envoie que ce qui a bougé. Les
 * ouvertures des autres semaines ne sont jamais touchées.
 *
 * Spec : docs/superpowers/specs/2026-09-09-refonte-creneaux-bandes-design.md
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, format, startOfWeek } from "date-fns";
import { fr } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Loader2, Save, AlertTriangle } from "lucide-react";
import api from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import TimeBandGrid, { type Lane } from "./TimeBandGrid";
import LaneFilter from "./LaneFilter";
import CapacityCurve, { type CapacityDay } from "./CapacityCurve";
import type { AvailabilityWindow } from "@/lib/room-capacity";
import {
  diffOpenings,
  openingsToBands,
  type OpeningRow,
} from "@/lib/openings-diff";
import {
  formatDuration,
  hhmmToMinutes,
  mergeIntervals,
  type Band,
} from "@/lib/time-bands";
import { estimateSlotsNeeded, formatSlotEstimate } from "@/lib/slot-estimator";
import { generateOpeningsFromCapacity } from "@/lib/auto-openings";
import { Sparkles } from "lucide-react";
import { localYmd, MERGE_TOLERANCE_MIN } from "@/lib/availability-bands";

interface ApiOpening extends OpeningRow {
  slots_total?: number;
  slots_occupied?: number;
  /** Créneaux ayant atteint leur quota d'examinateurs (statut ready/published/full). */
  slots_ready?: number;
}

interface Props {
  epreuveId: string;
  epreuveName?: string;
  /** Date de début de l'épreuve, pour ouvrir la grille sur la bonne semaine. */
  dateDebut?: string | null;
  /** Paramètres d'estimation du nombre de créneaux nécessaires. */
  candidatsAttendus?: number | null;
  margePct?: number | null;
  isGroupEpreuve?: boolean;
  groupSize?: number | null;
  minCandidates?: number | null;
  /** Examinateurs requis par salle en collectif / en individuel (courbe « C »). */
  evaluatorsPerGroupRoom?: number;
  evaluatorsPerIndividualRoom?: number;
  /** Durée d'un créneau et roulement — pour dimensionner la génération auto. */
  durationMinutes?: number;
  roulementMinutes?: number;
  onSaved?: () => void;
}

const FALLBACK_ROOMS = ["205", "217", "219", "235", "238-240", "242-244"];

export default function RoomOpeningsGrid({
  epreuveId,
  epreuveName,
  dateDebut,
  candidatsAttendus,
  margePct,
  isGroupEpreuve,
  groupSize,
  minCandidates,
  evaluatorsPerGroupRoom = 4,
  evaluatorsPerIndividualRoom = 2,
  durationMinutes = 30,
  roulementMinutes = 10,
  onSaved,
}: Props) {
  const { toast } = useToast();

  const [weekOffset, setWeekOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [openings, setOpenings] = useState<ApiOpening[]>([]);
  const [bands, setBands] = useState<Band[]>([]);
  const [rooms, setRooms] = useState<string[]>(FALLBACK_ROOMS);
  const [visibleRooms, setVisibleRooms] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  /** Dispos de TOUS les examinateurs sur la semaine, pour la courbe « C ». */
  const [staffRows, setStaffRows] = useState<any[]>([]);
  const [dirty, setDirty] = useState(false);

  const thisMonday = useMemo(
    () => startOfWeek(new Date(), { weekStartsOn: 1 }),
    [],
  );

  const days = useMemo(() => {
    const monday = addDays(thisMonday, (weekOffset ?? 0) * 7);
    return Array.from({ length: 5 }, (_, i) => addDays(monday, i));
  }, [thisMonday, weekOffset]);

  const dayKeys = useMemo(() => days.map(localYmd), [days]);

  const lanes: Lane[] = useMemo(
    () => rooms.map((r) => ({ id: r, label: r })),
    [rooms],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const noCache = { headers: { "Cache-Control": "no-store" }, params: { t: Date.now() } };
      const [openRes, settingsRes, staffRes] = await Promise.all([
        api.get("/openings", { ...noCache, params: { ...noCache.params, epreuveId } }),
        api.get("/settings", noCache).catch(() => ({ data: {} })),
        // Dispos de tous les examinateurs : alimente la courbe « C ». Un
        // échec ici ne doit pas empêcher de tracer des ouvertures.
        api
          .get("/availability/all", noCache)
          .catch(() => ({ data: [] as any[] })),
      ]);

      setStaffRows(Array.isArray(staffRes.data) ? staffRes.data : []);

      const list: ApiOpening[] = Array.isArray(openRes.data) ? openRes.data : [];
      setOpenings(list);

      // Les salles connues : celles déclarées en réglages, plus celles déjà
      // utilisées par des ouvertures (on n'efface jamais une salle qui porte
      // des données, même si elle n'est plus dans la liste).
      const declared = String(settingsRes.data?.rooms || "")
        .split(",")
        .map((r: string) => r.trim())
        .filter(Boolean);
      // Array.from plutôt que le spread : la cible TypeScript du projet
      // n'autorise pas l'itération directe d'un Set.
      const used = Array.from(new Set(list.map((o) => o.room).filter(Boolean)));
      const merged = Array.from(
        new Set([...(declared.length ? declared : FALLBACK_ROOMS), ...used]),
      );
      setRooms(merged);
      setVisibleRooms((prev) => (prev.length ? prev.filter((r) => merged.includes(r)) : merged));

      setDirty(false);
      setWarnings([]);
      return list;
    } catch (e: any) {
      console.error(e);
      toast(e?.response?.data?.error || "Échec du chargement des ouvertures", "error");
      return [] as ApiOpening[];
    } finally {
      setLoading(false);
    }
  }, [epreuveId, toast]);

  // Première ouverture de la grille : on se place sur la semaine qui contient
  // le début de l'épreuve, ou la première ouverture existante — plutôt que sur
  // la semaine courante, souvent vide.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await load();
      if (cancelled || weekOffset !== null) return;
      const dates = list.map((o) => String(o.date).slice(0, 10)).sort();
      const anchor = dates[0] || (dateDebut ? String(dateDebut).slice(0, 10) : null);
      if (!anchor) {
        setWeekOffset(0);
        return;
      }
      const [y, m, d] = anchor.split("-").map(Number);
      const target = startOfWeek(new Date(y, m - 1, d, 12), { weekStartsOn: 1 });
      setWeekOffset(Math.round((target.getTime() - thisMonday.getTime()) / (7 * 864e5)));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epreuveId]);

  // Les bandes se recalculent depuis les ouvertures à chaque changement de
  // semaine — sauf si l'admin a des modifications non enregistrées.
  useEffect(() => {
    if (dirty) return;
    setBands(openingsToBands(openings, dayKeys));
  }, [openings, dayKeys, dirty]);

  const handleChange = (next: Band[]) => {
    setBands(next);
    setDirty(true);
  };

  /**
   * Changer de semaine avec des modifications non enregistrées est dangereux :
   * `bands` porte un dayIndex RELATIF à la semaine affichée (0=lundi…4=vendredi),
   * pas une date absolue. Si on change de semaine sans avertir, l'effet qui
   * recharge les bandes depuis `openings` est bloqué par `dirty` — les bandes
   * de l'ancienne semaine restent affichées, mais réinterprétées sur les
   * dates de la NOUVELLE semaine. Un enregistrement à ce moment daterait les
   * créneaux au mauvais jour, silencieusement.
   */
  const goToWeek = (next: number) => {
    if (dirty) {
      const keep = window.confirm(
        "Cette semaine a des ouvertures non enregistrées. Changer de semaine les abandonnera. Continuer ?",
      );
      if (!keep) return;
      setDirty(false);
    }
    setWeekOffset(next);
  };

  /**
   * Fenêtres de disponibilité par jour affiché.
   *
   * Les lignes brutes sont FUSIONNÉES avant comptage (même tolérance que la
   * grille de saisie). Sans cela, une dispo saisie créneau par créneau —
   * 10:05-10:25, 10:30-10:50, 10:55-11:15… — ne couvre jamais une tranche de
   * 30 minutes d'un seul tenant, et la courbe annonce zéro examinateur alors
   * que la personne est là toute la matinée. Les trous de cinq minutes sont
   * du roulement entre créneaux, pas des absences.
   */
  const capacityDays: CapacityDay[] = useMemo(() => {
    const openedPerDay = new Map<string, Set<string>>();
    for (const b of bands) {
      const key = dayKeys[b.dayIndex];
      if (!key) continue;
      const set = openedPerDay.get(key) ?? new Set<string>();
      set.add(b.laneId);
      openedPerDay.set(key, set);
    }

    // Regroupement par (jour, membre) avant fusion.
    const byDayMember = new Map<string, Map<string, { start: number; end: number }[]>>();
    for (const r of staffRows) {
      if (!r?.date || !r.start_time || !r.end_time) continue;
      const key = String(r.date).slice(0, 10);
      const memberId = String(r.member_id ?? r.member?.id ?? r.id);
      const perMember = byDayMember.get(key) ?? new Map();
      const list = perMember.get(memberId) ?? [];
      list.push({
        start: hhmmToMinutes(String(r.start_time)),
        end: hhmmToMinutes(String(r.end_time)),
      });
      perMember.set(memberId, list);
      byDayMember.set(key, perMember);
    }

    return days.map((d, i) => {
      const key = dayKeys[i];
      const windows: AvailabilityWindow[] = [];
      const perMember = byDayMember.get(key);
      perMember?.forEach((intervals, memberId) => {
        for (const iv of mergeIntervals(intervals, MERGE_TOLERANCE_MIN)) {
          windows.push({ memberId, startMin: iv.start, endMin: iv.end });
        }
      });
      return {
        label: format(d, "EEE d", { locale: fr }),
        windows,
        roomsOpened: openedPerDay.get(key)?.size ?? 0,
      };
    });
  }, [days, dayKeys, staffRows, bands]);

  const diff = useMemo(
    () => diffOpenings(openings, bands, dayKeys),
    [openings, bands, dayKeys],
  );

  const handleSave = async () => {
    setSaving(true);
    setWarnings([]);
    const problems: string[] = [];
    try {
      // Ordre imposé ENTRE LES PHASES : on libère d'abord la place
      // (suppressions), on ajuste ensuite, on crée en dernier. L'inverse
      // ferait échouer des créations sur un chevauchement avec une ouverture
      // qu'on s'apprêtait à retirer. En revanche les opérations D'UNE MÊME
      // PHASE portent sur des salles/dates distinctes (bandes indépendantes)
      // : les enchaîner en série un par un est ce qui rendait
      // l'enregistrement lent dès qu'on ouvrait plusieurs salles à la fois.
      // Promise.all les lance en parallèle sans changer l'ordre des phases.
      const occupiedBlocked: { id: string; occupiedCount: number }[] = [];
      await Promise.all(
        diff.toDelete.map(async (id) => {
          try {
            await api.delete(`/openings/${id}`);
          } catch (e: any) {
            const occupied = e?.response?.data?.occupied;
            if (occupied?.length) {
              occupiedBlocked.push({ id, occupiedCount: occupied.length });
            } else {
              problems.push(e?.response?.data?.error || "Échec d'une suppression");
            }
          }
        }),
      );

      // Une ouverture avec des inscrits est refusée par défaut (409) — sans
      // ça, retirer une bande qui a ne serait-ce qu'un seul candidat inscrit
      // était impossible depuis cette grille, même en cas d'erreur de saisie
      // manifeste. On demande UNE confirmation groupée puis on force
      // (DELETE ?force=true, qui notifie les candidats concernés) plutôt que
      // de laisser l'ouverture bloquée indéfiniment.
      if (occupiedBlocked.length > 0) {
        const totalOccupied = occupiedBlocked.reduce(
          (s, o) => s + o.occupiedCount,
          0,
        );
        const confirmForce = window.confirm(
          `${occupiedBlocked.length} ouverture(s) à supprimer ont ${totalOccupied} créneau(x) déjà inscrit(s). ` +
            `Forcer la suppression quand même ? Les candidats concernés seront prévenus que leur créneau est annulé.`,
        );
        await Promise.all(
          occupiedBlocked.map(async ({ id, occupiedCount }) => {
            if (!confirmForce) {
              problems.push(
                `Suppression refusée : ${occupiedCount} créneau(x) ont déjà des inscrits.`,
              );
              return;
            }
            try {
              await api.delete(`/openings/${id}`, { params: { force: true } });
            } catch (e: any) {
              problems.push(
                e?.response?.data?.error || "Échec de la suppression forcée",
              );
            }
          }),
        );
      }

      await Promise.all(
        diff.toUpdate.map(async (u) => {
          try {
            await api.put(`/openings/${u.id}`, {
              room: u.room,
              date: u.date,
              startTime: u.startTime,
              endTime: u.endTime,
            });
          } catch (e: any) {
            problems.push(
              `${u.room} le ${u.date} : ${e?.response?.data?.error || "échec de la modification"}`,
            );
          }
        }),
      );

      await Promise.all(
        diff.toCreate.map(async (c) => {
          try {
            const res = await api.post("/openings", {
              epreuveId,
              room: c.room,
              dates: [c.date],
              startTime: c.startTime,
              endTime: c.endTime,
            });
            for (const w of res.data?.warnings || []) problems.push(w);
          } catch (e: any) {
            problems.push(
              `${c.room} le ${c.date} : ${e?.response?.data?.error || "échec de la création"}`,
            );
          }
        }),
      );

      setDirty(false);
      await load();
      onSaved?.();

      if (problems.length) {
        setWarnings(problems);
        toast(`Enregistré, avec ${problems.length} avertissement(s)`, "error");
      } else {
        toast("Ouvertures enregistrées", "success");
      }
    } finally {
      setSaving(false);
    }
  };

  const weekOpenings = openings.filter((o) =>
    dayKeys.includes(String(o.date).slice(0, 10)),
  );
  const slotsThisWeek = weekOpenings.reduce((s, o) => s + (o.slots_total ?? 0), 0);
  const slotsTotal = openings.reduce((s, o) => s + (o.slots_total ?? 0), 0);
  const readyTotal = openings.reduce((s, o) => s + (o.slots_ready ?? 0), 0);
  const bandMinutes = bands.reduce((s, b) => s + (b.endMin - b.startMin), 0);
  const pending =
    diff.toCreate.length + diff.toUpdate.length + diff.toDelete.length;

  const roomCounts = bands.reduce<Record<string, number>>((acc, b) => {
    acc[b.laneId] = (acc[b.laneId] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-gray-200 p-0.5">
          <button
            onClick={() => goToWeek((weekOffset ?? 0) - 1)}
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
            onClick={() => goToWeek((weekOffset ?? 0) + 1)}
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-50"
            aria-label="Semaine suivante"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-3">
          {pending > 0 && (
            <span className="text-xs text-amber-700">
              {diff.toCreate.length > 0 && `${diff.toCreate.length} à créer`}
              {diff.toUpdate.length > 0 &&
                `${diff.toCreate.length ? " · " : ""}${diff.toUpdate.length} à modifier`}
              {diff.toDelete.length > 0 &&
                `${diff.toCreate.length || diff.toUpdate.length ? " · " : ""}${diff.toDelete.length} à supprimer`}
            </span>
          )}
          <Button onClick={handleSave} disabled={saving || loading || pending === 0}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Enregistrer
          </Button>
        </div>
      </div>

      <div className="mb-3 flex items-start gap-2">
        <CapacityCurve
          days={capacityDays}
          totalRooms={(visibleRooms.length ? visibleRooms : rooms).length}
          evaluatorsPerGroupRoom={evaluatorsPerGroupRoom}
          evaluatorsPerIndividualRoom={evaluatorsPerIndividualRoom}
        />
        <LaneFilter
          lanes={lanes}
          visible={visibleRooms.length ? visibleRooms : rooms}
          onChange={setVisibleRooms}
          counts={roomCounts}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-gray-500">
        <span>
          <strong className="text-gray-900">{bands.length}</strong> ouverture
          {bands.length > 1 ? "s" : ""} cette semaine · {formatDuration(bandMinutes)}
        </span>
        <span>
          <strong className="text-gray-900">{slotsThisWeek}</strong> créneau
          {slotsThisWeek > 1 ? "x" : ""} générés cette semaine
        </span>
        <span className="text-gray-400">
          {slotsTotal} au total sur l&apos;épreuve
          {occupiedTotal > 0 && ` · ${occupiedTotal} déjà occupé${occupiedTotal > 1 ? "s" : ""}`}
        </span>
        {dirty && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            non enregistré
          </span>
        )}
      </div>

      {(() => {
        const est = estimateSlotsNeeded({
          candidatsAttendus,
          margePct,
          isGroupEpreuve,
          groupSize,
          minCandidates,
        });
        if (!est.applicable) {
          return (
            <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500">
              Renseignez « candidats attendus » dans la configuration de
              l&apos;épreuve pour savoir combien de créneaux ouvrir.
            </div>
          );
        }
        // On compare au total de l'épreuve, pas à la semaine : l'admin ouvre
        // ses salles sur plusieurs semaines, c'est le cumul qui compte.
        const manque = est.min - slotsTotal;
        const suffisant = slotsTotal >= est.min;
        return (
          <div
            className={`mb-3 rounded-lg border px-3 py-2 text-sm ${
              suffisant
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-amber-200 bg-amber-50 text-amber-900"
            }`}
          >
            <strong>{candidatsAttendus}</strong> candidats attendus
            {margePct ? `, marge +${margePct}%` : ""} →{" "}
            <strong>{formatSlotEstimate(est)}</strong> nécessaires. Vos
            ouvertures en produisent <strong>{slotsTotal}</strong>
            {suffisant ? (
              est.max > est.min && slotsTotal < est.max ? (
                <> — de quoi passer tout le monde, avec peu de marge.</>
              ) : (
                <> — c&apos;est suffisant.</>
              )
            ) : (
              <>
                {" "}
                — il en manque <strong>{manque}</strong>.
              </>
            )}
            {!suffisant && (
              <div className="mt-2 flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-7 border-amber-300 bg-white px-2.5 text-xs text-amber-900 hover:bg-amber-100"
                  onClick={() => {
                    const result = generateOpeningsFromCapacity({
                      days: capacityDays.map((d, i) => ({
                        dayIndex: i,
                        windows: d.windows,
                      })),
                      rooms: visibleRooms.length ? visibleRooms : rooms,
                      evaluatorsPerGroupRoom,
                      evaluatorsPerIndividualRoom,
                      slotSpanMin: durationMinutes + roulementMinutes,
                      targetSlots: manque,
                    });
                    if (result.bands.length === 0) {
                      toast(
                        "Aucun examinateur disponible cette semaine ne permet d'ouvrir de salle. Essayez une autre semaine, ou complétez manuellement.",
                        "error",
                      );
                      return;
                    }
                    // Ajoutées aux bandes existantes, pas en remplacement : on
                    // complète le manque, on n'efface rien de déjà tracé.
                    setBands((prev) => [...prev, ...result.bands]);
                    setDirty(true);
                    toast(
                      result.reachedTarget
                        ? `${result.bands.length} ouverture(s) proposée(s), ~${result.estimatedSlots} créneaux. Relisez avant d'enregistrer.`
                        : `${result.bands.length} ouverture(s) proposée(s) — l'effectif de la semaine ne couvre pas tout le manque (~${result.estimatedSlots}/${manque} créneaux). Relisez avant d'enregistrer.`,
                      result.reachedTarget ? "success" : "error",
                    );
                  }}
                >
                  <Sparkles className="mr-1 h-3 w-3" />
                  Générer selon la capacité de cette semaine
                </Button>
                <span className="text-xs text-amber-700">
                  Propose des ouvertures là où l&apos;effectif le permet —
                  rien n&apos;est enregistré tant que vous ne cliquez pas
                  « Enregistrer ».
                </span>
              </div>
            )}
          </div>
        );
      })()}

      {warnings.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <div className="mb-1 flex items-center gap-1.5 font-medium">
            <AlertTriangle className="h-4 w-4" />
            Certaines opérations n&apos;ont pas abouti
          </div>
          <ul className="list-inside list-disc space-y-0.5 text-xs">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {loading || weekOffset === null ? (
        <div className="flex h-64 items-center justify-center text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <TimeBandGrid
          days={days}
          lanes={lanes.filter((l) =>
            (visibleRooms.length ? visibleRooms : rooms).includes(l.id),
          )}
          bands={bands}
          onChange={handleChange}
          pxPerMin={(visibleRooms.length || rooms.length) > 2 ? 0.75 : 0.9}
        />
      )}

      <p className="mt-2 text-xs text-gray-400">
        Une bande = une plage d&apos;ouverture de salle{epreuveName ? ` pour « ${epreuveName.trim()} »` : ""}.
        Les créneaux sont découpés automatiquement à l&apos;enregistrement, selon
        la durée et le roulement de l&apos;épreuve. Les créneaux déjà occupés ne
        sont jamais supprimés.
      </p>
    </div>
  );
}
