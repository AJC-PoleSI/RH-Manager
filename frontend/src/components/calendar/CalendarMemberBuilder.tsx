"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import api from "@/lib/api";

interface CalendarMemberBuilderProps {
  memberId: string;
  toast: any;
  epreuvesConfigured: any[];
  onSlotsChange?: () => void; // appelé après sauvegarde pour refresh des slots assignés
}

export default function CalendarMemberBuilder({
  memberId,
  toast,
  epreuvesConfigured,
  onSlotsChange,
}: CalendarMemberBuilderProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Tous les créneaux créés par l'admin (date, Heure)
  const [adminSlots, setAdminSlots] = useState<any[]>([]);
  // Settings contenant weeklySchedule pour filtrer les jours ouverts
  const [settings, setSettings] = useState<any>(null);

  // Disponibilités cochées par l'utilisateur: Set is easier for fast toggle. Format "{date}|{start_time}|{end_time}"
  const [selectedBlocks, setSelectedBlocks] = useState<Set<string>>(new Set());
  const [initialBlocks, setInitialBlocks] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      // Actualisation explicite du State (React) pour supprimer les résidus de la session précédente
      setAdminSlots([]);
      setSelectedBlocks(new Set());
      setSettings(null);

      // On s'assure d'outrepasser tout cache potentiel au niveau navigateur / proxy
      const fetchOptions = {
        headers: {
          "Cache-Control":
            "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
        params: { t: new Date().getTime() },
      };

      // 0. Fetch les settings pour la configuration hebdomadaire
      const resSettings = await api.get("/settings", fetchOptions);
      setSettings(resSettings.data);

      // 1. Fetch tous les slots (creneaux admins)
      const resSlots = await api.get("/slots/all", fetchOptions);

      // On filtre pour ne garder que les slots des épreuves configurées AND parent present
      // ET uniquement les jours ouverts selon weeklySchedule
      const validEpreuveIds = epreuvesConfigured.map((e) => e.id);
      const daysOfWeek = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

      const filteredSlots = resSlots.data.filter((s: any) => {
        // Filter 1: Vérifier que l'épreuve existe et est configurée
        if (!s.epreuve || !validEpreuveIds.includes(s.epreuve_id)) {
          return false;
        }

        // Filter 2: Vérifier que le jour est ouvert
        // weeklySchedule peut être un JSON string (API) ou un objet (contexte)
        if (s.date) {
          const dateObj = new Date(s.date);
          const dayIndex = dateObj.getDay(); // 0=dim, 6=sam
          const dayKey = daysOfWeek[dayIndex];

          // Sécurité : exclure weekends par défaut (sam/dim)
          if (dayIndex === 0 || dayIndex === 6) return false;

          // Filtrage fin via weeklySchedule si disponible
          const rawSchedule = resSettings.data?.weeklySchedule;
          if (rawSchedule) {
            const schedule = typeof rawSchedule === "string"
              ? (() => { try { return JSON.parse(rawSchedule); } catch { return null; } })()
              : rawSchedule;
            const dayConfig = schedule?.[dayKey];
            if (dayConfig && !dayConfig.isOpen) return false;
          }
        }

        return true;
      });

      setAdminSlots(filteredSlots);

      // 2. Fetch les disponibilités du membre
      const resMyAvail = await api.get("/availability", fetchOptions);

      // Build a set of temporal keys (date|start|end) from existing availabilities,
      // then expand them to per-épreuve keys by matching against adminSlots.
      const temporalAvails = new Set<string>();
      resMyAvail.data.forEach((av: any) => {
        if (av.date) {
          const dateOnly = av.date.split("T")[0];
          const st = (av.start_time || "").slice(0, 5);
          const et = (av.end_time || "").slice(0, 5);
          temporalAvails.add(`${dateOnly}|${st}|${et}`);
        }
      });

      // Expand to per-épreuve keys: for each temporal key, find matching slots
      // and create a key with epreuveId appended
      const initials = new Set<string>();
      filteredSlots.forEach((slot: any) => {
        if (!slot.date || !slot.start_time || !slot.end_time) return;
        const d = slot.date.split("T")[0];
        const st = (slot.start_time || "").slice(0, 5);
        const et = (slot.end_time || "").slice(0, 5);
        const temporalKey = `${d}|${st}|${et}`;
        if (temporalAvails.has(temporalKey)) {
          const epreuveId = slot.epreuve_id || slot.epreuveId || "none";
          initials.add(`${temporalKey}|${epreuveId}`);
        }
      });
      setSelectedBlocks(initials);
      setInitialBlocks(new Set(initials));
    } catch (e) {
      console.error(e);
      toast("Erreur de synchronisation", "error");
    } finally {
      setLoading(false);
    }
  }, [epreuvesConfigured, toast]);

  useEffect(() => {
    fetchData();
  }, [memberId, fetchData]);

  // 3. Traitement des slots pour la grille Calendrier (Jours en colonnes, Heures en lignes)
  // Key now includes epreuve_id to separate different épreuves on the same time slot.
  // Same épreuve + same time + different rooms = grouped (correct business rule).
  // Different épreuves + same time = separate blocks (bug fix).
  const gridData = useMemo(() => {
    const datesSet = new Set<string>();
    const timesSet = new Set<string>();
    const blocksMap = new Map<string, any>(); // key = "date|start|end|epreuveId"

    adminSlots.forEach((slot) => {
      if (!slot.date || !slot.start_time || !slot.end_time) return;

      const d = slot.date.split("T")[0];
      const st = (slot.start_time || "").slice(0, 5);
      const et = (slot.end_time || "").slice(0, 5);
      const epreuveId = slot.epreuve_id || slot.epreuveId || "none";
      datesSet.add(d);
      timesSet.add(st);

      // Group by épreuve: same épreuve + same time = one block (rooms are grouped)
      const key = `${d}|${st}|${et}|${epreuveId}`;
      if (!blocksMap.has(key)) {
        blocksMap.set(key, {
          date: d,
          startTime: st,
          endTime: et,
          epreuveId,
          epreuveName:
            epreuvesConfigured.find((e) => e.id === epreuveId)?.name ||
            "Épreuve",
          rooms: new Set<string>(),
          key,
        });
      }

      if (slot.room) {
        blocksMap.get(key).rooms.add(slot.room);
      }
    });

    const uniqueDates = Array.from(datesSet).sort();
    const uniqueTimes = Array.from(timesSet).sort((a, b) => a.localeCompare(b));

    return { uniqueDates, uniqueTimes, blocksMap };
  }, [adminSlots, epreuvesConfigured]);

  const toggleBlock = (key: string) => {
    setSelectedBlocks((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  };

  // Raccourci : cocher/décocher tous les blocs qui passent le filtre.
  // Si tous sont déjà cochés → tout décocher, sinon tout cocher.
  const toggleAllBlocks = (filter: (block: any) => boolean) => {
    setSelectedBlocks((prev) => {
      const keys: string[] = [];
      for (const [k, v] of Array.from(gridData.blocksMap.entries())) {
        if (filter(v)) keys.push(k);
      }
      if (keys.length === 0) return prev;
      const allSelected = keys.every((k) => prev.has(k));
      const newSet = new Set(prev);
      keys.forEach((k) => (allSelected ? newSet.delete(k) : newSet.add(k)));
      return newSet;
    });
  };

  const handleSave = async () => {
    try {
      // 1. Detect withdrawals from ASSIGNED slots
      const withdrawnSlots: any[] = [];
      adminSlots.forEach(slot => {
        if (!slot.date || !slot.start_time || !slot.end_time) return;
        
        // Is member assigned to this slot?
        const isAssigned = slot.members?.some((m: any) => m.member_id === memberId);
        if (!isAssigned) return;

        const d = slot.date.split("T")[0];
        const st = (slot.start_time || "").slice(0, 5);
        const et = (slot.end_time || "").slice(0, 5);
        const epreuveId = slot.epreuve_id || slot.epreuveId || "none";
        const key = `${d}|${st}|${et}|${epreuveId}`;
        
        // Was it selected initially but now unchecked?
        if (initialBlocks.has(key) && !selectedBlocks.has(key)) {
          withdrawnSlots.push(slot);
        }
      });

      // 2. Warn if withdrawing from under-staffed slot with candidates
      const criticalWithdrawals = withdrawnSlots.filter(s => {
        const hasCandidates = s.enrollments?.length > 0;
        const willBeUnderStaffed = (s.members?.length || 1) - 1 < (s.min_members || 2);
        return hasCandidates && willBeUnderStaffed;
      });

      if (criticalWithdrawals.length > 0) {
        const confirmMsg = `Attention ! Vous vous retirez de ${criticalWithdrawals.length} créneau(x) assigné(s) où des candidats sont déjà inscrits et qui manqueront d'examinateurs.\n\nÊtes-vous sûr de vouloir vous désinscrire de ces créneaux ?`;
        if (!window.confirm(confirmMsg)) {
          return; // Abort save
        }
      }

      setSaving(true);

      // 3. Process explicit withdrawals from slots to trigger auto-replacement and notifications
      for (const slot of withdrawnSlots) {
        try {
          await api.post("/slots/toggle-member", {
            slotId: slot.id,
            action: "remove"
          });
        } catch (e) {
          console.error("Erreur retrait slot", slot.id, e);
        }
      }

      // 4. Save new availabilities
      // Keys are now "date|start|end|epreuveId" — strip epreuveId and
      // deduplicate so we don't create duplicate temporal availabilities.
      const daysOfWeekMap = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

      const seenTemporal = new Set<string>();
      const payload: Array<{ weekday: string; date: string; startTime: string; endTime: string }> = [];
      Array.from(selectedBlocks).forEach((key) => {
        const parts = key.split("|");
        const [date, start, end] = parts; // ignore parts[3] (epreuveId)
        const temporalKey = `${date}|${start}|${end}`;
        if (seenTemporal.has(temporalKey)) return; // deduplicate
        seenTemporal.add(temporalKey);
        const weekdayInt = new Date(date).getDay();
        payload.push({
          weekday: daysOfWeekMap[weekdayInt],
          date: date,
          startTime: start,
          endTime: end,
        });
      });

      // PUT /availability re-runs the intelligent dispatch server-side
      // (équité + brassage) over ALL availabilities, so no separate
      // /api/dispatch/run call is needed here — that would just run the
      // same global re-balance twice and risk a race on the assignments.
      await api.put("/availability", { availabilities: payload });
      toast("Disponibilités synchronisées globales 🎉", "success");

      // Update initialBlocks to match current
      setInitialBlocks(new Set(selectedBlocks));

      // Refresh des slots assignés côté parent
      onSlotsChange?.();
      
      // Refresh adminSlots in this component to reflect updated members
      fetchData();
    } catch (error: any) {
      console.error(error);
      toast(error.response?.data?.error || "Erreur de sauvegarde", "error");
    } finally {
      setSaving(false);
    }
  };

  const { uniqueDates, uniqueTimes, blocksMap } = gridData;

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  const formatTime = (t: string) => {
    const parts = t.split(":");
    return `${parts[0]}h${parts[1] || "00"}`;
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-4 bg-gray-50/50">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            🗓️ Calendrier de mes Disponibilités
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Cochez les tranches horaires où vous êtes libre dans la grille
            ci-dessous.
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2.5 bg-blue-600 text-white font-medium rounded-lg text-sm hover:bg-blue-700 transition shadow-sm disabled:opacity-50 flex items-center gap-2"
        >
          {saving ? "Sauvegarde..." : "💾 Enregistrer mes disponibilités"}
        </button>
      </div>

      <div className="p-4 overflow-x-auto">
        {uniqueDates.length === 0 ? (
          <div className="text-center py-12 text-gray-500 text-sm border-2 border-dashed border-gray-200 rounded-xl">
            Aucun créneau d&apos;évaluation n&apos;a encore été généré par
            l&apos;administration.
          </div>
        ) : (
          <table className="w-full text-sm text-left border-collapse">
            <thead>
              <tr>
                <th className="p-3 font-semibold text-gray-500 bg-gray-50 border-b border-r border-gray-200 sticky left-0 z-10 w-24">
                  Horaire
                </th>
                {uniqueDates.map((date) => {
                  const dateObj = new Date(date);
                  const isWeekend =
                    dateObj.getDay() === 0 || dateObj.getDay() === 6;
                  return (
                    <th
                      key={date}
                      className={`p-3 font-semibold text-center border-b border-gray-200 min-w-[140px] ${isWeekend ? "bg-orange-50/50 text-orange-800" : "bg-gray-50 text-gray-700"}`}
                    >
                      {dateObj.toLocaleDateString("fr-FR", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {uniqueTimes.map((time) => (
                <tr
                  key={time}
                  className="hover:bg-gray-50/30 transition-colors"
                >
                  <td className="p-3 font-medium text-gray-600 bg-gray-50/50 border-r border-b border-gray-100 sticky left-0 z-10 text-right">
                    {formatTime(time)}
                  </td>
                  {uniqueDates.map((date) => {
                    // Find ALL blocks for this date + time (there may be multiple épreuves)
                    const matchingBlocks: Array<{ key: string; block: any }> = [];
                    for (const [k, v] of Array.from(blocksMap.entries())) {
                      if (v.date === date && v.startTime === time) {
                        matchingBlocks.push({ key: k, block: v });
                      }
                    }

                    if (matchingBlocks.length === 0) {
                      return (
                        <td
                          key={`${date}-${time}`}
                          className="p-2 border-b border-gray-100 bg-gray-50/10 text-center"
                        >
                          <span className="text-gray-300">-</span>
                        </td>
                      );
                    }

                    return (
                      <td
                        key={`${date}-${time}`}
                        className="p-2 border-b border-gray-100 align-top"
                      >
                        <div className="flex flex-col gap-1.5">
                          {matchingBlocks.map(({ key: bKey, block: blockObj }) => {
                            const isSelected = selectedBlocks.has(bKey);
                            const roomsArr = Array.from(
                              (blockObj.rooms || new Set()) as Set<string>,
                            );

                            return (
                              <div
                                key={bKey}
                                onClick={() => toggleBlock(bKey)}
                                className={`
                                  cursor-pointer rounded-lg p-3 min-h-[70px] border-2 transition-all flex flex-col items-center justify-center gap-1.5 relative
                                  ${
                                    isSelected
                                      ? "bg-blue-50 border-blue-500 shadow-sm"
                                      : "bg-white border-dashed border-gray-300 hover:border-blue-300 hover:bg-blue-50/30"
                                  }
                                `}
                              >
                                {isSelected && (
                                  <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center shadow">
                                    <span className="text-white text-xs font-bold">
                                      ✓
                                    </span>
                                  </div>
                                )}
                                <span
                                  className={`text-xs font-bold tracking-tight ${isSelected ? "text-blue-900" : "text-gray-800"}`}
                                >
                                  {formatTime(blockObj.startTime)} → {formatTime(blockObj.endTime)}
                                </span>
                                <span
                                  className={`text-[11px] font-semibold px-2 py-0.5 rounded-full leading-snug text-center ${isSelected ? "bg-blue-200 text-blue-900" : "bg-gray-100 text-gray-600"}`}
                                >
                                  {blockObj.epreuveName}
                                </span>
                                {roomsArr.length > 0 && (
                                  <span className="text-[10px] text-gray-400">
                                    {roomsArr.join(", ")}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer warning */}
      <div className="px-5 py-3 border-t border-gray-100 bg-amber-50 flex items-start gap-3">
        <span className="text-amber-600 text-lg leading-none mt-0.5">⚠️</span>
        <p className="text-xs text-amber-800">
          <strong>N&apos;oubliez pas d&apos;Enregistrer</strong> pour figer vos
          disponibilités dans le système. Les cases grisées correspondent à des
          absences de configuration d&apos;épreuve pour ces horaires.
        </p>
      </div>
    </div>
  );
}
