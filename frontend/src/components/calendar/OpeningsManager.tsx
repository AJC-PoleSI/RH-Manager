"use client";

// Tableau des ouvertures de salles : l'admin déclare des plages (salle +
// date + horaires + pause), le système découpe en créneaux. Remplace la
// création clic-par-clic. Spec :
// docs/superpowers/specs/2026-07-07-creation-creneaux-ouvertures-design.md

import { useState, useEffect, useCallback, useMemo } from "react";
import api from "@/lib/api";
import { sliceOpening } from "@/lib/opening-slicer";

interface OpeningsManagerProps {
  selectedEpreuveId: string;
  epreuve: any;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  onUpdate: () => void;
}

interface Opening {
  id: string;
  room: string;
  date: string;
  start_time: string;
  end_time: string;
  break_start: string | null;
  break_end: string | null;
  slots_total: number;
  slots_occupied: number;
  conflicts: {
    id: string;
    date: string;
    start_time: string;
    end_time: string;
    room: string;
  }[];
}

interface OpeningForm {
  room: string;
  date: string;
  startTime: string;
  endTime: string;
  breakStart: string;
  breakEnd: string;
}

const EMPTY_FORM: OpeningForm = {
  room: "",
  date: "",
  startTime: "09:00",
  endTime: "17:00",
  breakStart: "",
  breakEnd: "",
};

// Même palette que CalendarAdminBuilder pour la cohérence visuelle
const ROOM_PALETTE = [
  { bg: "#DBEAFE", text: "#1E40AF" },
  { bg: "#E9D5FF", text: "#6D28D9" },
  { bg: "#D1FAE5", text: "#065F46" },
  { bg: "#FEF3C7", text: "#92400E" },
  { bg: "#FCE7F3", text: "#9D174D" },
  { bg: "#CFFAFE", text: "#155E75" },
];

function fmtDate(d: string): string {
  return new Date(d + "T12:00:00").toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export default function OpeningsManager({
  selectedEpreuveId,
  epreuve,
  toast,
  onUpdate,
}: OpeningsManagerProps) {
  const [openings, setOpenings] = useState<Opening[]>([]);
  const [loading, setLoading] = useState(true);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [form, setForm] = useState<OpeningForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<OpeningForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [hiddenConflicts, setHiddenConflicts] = useState<Set<string>>(
    new Set(),
  );
  // Modale duplication
  const [showDuplicate, setShowDuplicate] = useState(false);
  const [dupSource, setDupSource] = useState("");
  const [dupTargets, setDupTargets] = useState<Set<string>>(new Set());

  const sliceParams = useMemo(
    () => ({
      durationMinutes:
        epreuve?.durationMinutes || epreuve?.duration_minutes || 30,
      roulementMinutes:
        epreuve?.roulementMinutes ?? epreuve?.roulement_minutes ?? 10,
    }),
    [epreuve],
  );

  const dateMin = (epreuve?.dateDebut || epreuve?.date_debut || "").slice(
    0,
    10,
  );
  const dateMax = (epreuve?.dateFin || epreuve?.date_fin || "").slice(0, 10);

  const fetchOpenings = useCallback(async () => {
    if (!selectedEpreuveId) return;
    try {
      setLoading(true);
      const res = await api.get(`/openings?epreuveId=${selectedEpreuveId}`);
      setOpenings(res.data || []);
      setMigrationMissing(false);
    } catch (e: any) {
      const details = String(e?.response?.data?.details || "");
      if (details.includes("room_openings")) {
        setMigrationMissing(true);
      } else {
        console.error("Erreur chargement ouvertures:", e);
        toast("Erreur lors du chargement des ouvertures", "error");
      }
    } finally {
      setLoading(false);
    }
  }, [selectedEpreuveId, toast]);

  useEffect(() => {
    fetchOpenings();
  }, [fetchOpenings]);

  // Aperçu live du nombre de créneaux pour un formulaire
  const previewCount = useCallback(
    (f: OpeningForm): number => {
      if (!f.startTime || !f.endTime) return 0;
      return sliceOpening(
        {
          startTime: f.startTime,
          endTime: f.endTime,
          breakStart: f.breakStart || null,
          breakEnd: f.breakEnd || null,
        },
        sliceParams,
      ).length;
    },
    [sliceParams],
  );

  const addPreview = previewCount(form);

  const refreshAll = useCallback(() => {
    fetchOpenings();
    onUpdate();
  }, [fetchOpenings, onUpdate]);

  const handleAdd = async () => {
    setBusy(true);
    try {
      const res = await api.post("/openings", {
        epreuveId: selectedEpreuveId,
        room: form.room,
        date: form.date,
        startTime: form.startTime,
        endTime: form.endTime,
        breakStart: form.breakStart || null,
        breakEnd: form.breakEnd || null,
      });
      toast(
        `Ouverture créée — ${res.data?.slots_created || 0} créneau(x) générés ✅`,
        "success",
      );
      setForm((prev) => ({ ...EMPTY_FORM, date: prev.date }));
      refreshAll();
    } catch (e: any) {
      toast(e?.response?.data?.error || "Erreur lors de la création", "error");
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (o: Opening) => {
    setEditingId(o.id);
    setEditForm({
      room: o.room,
      date: o.date,
      startTime: o.start_time,
      endTime: o.end_time,
      breakStart: o.break_start || "",
      breakEnd: o.break_end || "",
    });
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    setBusy(true);
    try {
      const res = await api.put(`/openings/${editingId}`, {
        room: editForm.room,
        date: editForm.date,
        startTime: editForm.startTime,
        endTime: editForm.endTime,
        breakStart: editForm.breakStart || null,
        breakEnd: editForm.breakEnd || null,
      });
      const { created, deleted, conflicts } = res.data || {};
      let msg = `Ouverture mise à jour — ${created ?? 0} créé(s), ${deleted ?? 0} supprimé(s)`;
      if (conflicts?.length > 0) {
        msg += ` · ⚠️ ${conflicts.length} créneau(x) occupé(s) hors de la nouvelle plage — à résoudre ci-dessous`;
      }
      toast(msg, conflicts?.length > 0 ? "info" : "success");
      setEditingId(null);
      refreshAll();
    } catch (e: any) {
      toast(
        e?.response?.data?.error || "Erreur lors de la modification",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (o: Opening) => {
    if (
      !window.confirm(
        `Supprimer l'ouverture ${o.room} du ${fmtDate(o.date)} (${o.start_time}–${o.end_time}) et ses créneaux libres ?`,
      )
    )
      return;
    setBusy(true);
    try {
      await api.delete(`/openings/${o.id}`);
      toast("Ouverture supprimée", "success");
      refreshAll();
    } catch (e: any) {
      if (e?.response?.status === 409) {
        const occupied = e.response.data?.occupied || [];
        const list = occupied
          .slice(0, 5)
          .map((s: any) => `· ${fmtDate(s.date)} ${s.start_time}`)
          .join("\n");
        if (
          window.confirm(
            `${occupied.length} créneau(x) de cette ouverture ont des inscrits :\n${list}\n\nSupprimer quand même ? Les inscrits seront notifiés.`,
          )
        ) {
          try {
            const res = await api.delete(`/openings/${o.id}?force=true`);
            toast(
              `Ouverture supprimée — ${res.data?.notified_candidates || 0} candidat(s) notifié(s)`,
              "success",
            );
            refreshAll();
          } catch (e2: any) {
            toast(
              e2?.response?.data?.error || "Erreur lors de la suppression",
              "error",
            );
          }
        }
      } else {
        toast(
          e?.response?.data?.error || "Erreur lors de la suppression",
          "error",
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteConflictSlot = async (slotId: string) => {
    if (
      !window.confirm(
        "Supprimer ce créneau occupé ? Les inscrits seront notifiés.",
      )
    )
      return;
    try {
      await api.delete(`/slots/${slotId}`);
      toast("Créneau supprimé, inscrits notifiés", "success");
      refreshAll();
    } catch (e: any) {
      toast(e?.response?.data?.error || "Erreur suppression créneau", "error");
    }
  };

  const handleDuplicate = async () => {
    if (!dupSource || dupTargets.size === 0) {
      toast("Choisissez une date source et au moins une date cible", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await api.post("/openings/duplicate", {
        epreuveId: selectedEpreuveId,
        sourceDate: dupSource,
        targetDates: Array.from(dupTargets),
      });
      const { created_openings, created_slots, warnings } = res.data || {};
      toast(
        `${created_openings || 0} ouverture(s) copiées, ${created_slots || 0} créneau(x) générés${warnings?.length ? ` · ${warnings.length} ignorée(s)` : ""}`,
        "success",
      );
      if (warnings?.length) console.warn("Duplication warnings:", warnings);
      setShowDuplicate(false);
      setDupTargets(new Set());
      refreshAll();
    } catch (e: any) {
      toast(e?.response?.data?.error || "Erreur duplication", "error");
    } finally {
      setBusy(false);
    }
  };

  // ── Données dérivées ──────────────────────────────────────────────
  const roomIndex = useMemo(() => {
    const rooms = Array.from(new Set(openings.map((o) => o.room))).sort();
    const map = new Map<string, number>();
    rooms.forEach((r, i) => map.set(r, i));
    return map;
  }, [openings]);

  const totalSlots = openings.reduce((s, o) => s + o.slots_total, 0);
  const totalOccupied = openings.reduce((s, o) => s + o.slots_occupied, 0);
  const maxCandidatesPerSlot = epreuve?.isGroupEpreuve
    ? epreuve?.groupSize || 1
    : 1;
  const allConflicts = openings
    .flatMap((o) => o.conflicts.map((c) => ({ ...c, openingRoom: o.room })))
    .filter((c) => !hiddenConflicts.has(c.id));

  const openingDates = Array.from(new Set(openings.map((o) => o.date))).sort();

  // Jours ouvrés de la période de l'épreuve (cibles de duplication)
  const weekdaysInRange = useMemo(() => {
    if (!dateMin || !dateMax) return [] as string[];
    const out: string[] = [];
    const cur = new Date(dateMin + "T12:00:00");
    const end = new Date(dateMax + "T12:00:00");
    while (cur <= end) {
      const dow = cur.getDay();
      if (dow !== 0 && dow !== 6) {
        out.push(
          `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`,
        );
      }
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }, [dateMin, dateMax]);

  if (migrationMissing) {
    return (
      <div className="bg-orange-50 border-2 border-orange-300 rounded-xl p-5 flex items-start gap-3">
        <span className="text-2xl">⚠️</span>
        <div>
          <p className="text-sm font-bold text-orange-800">
            Migration Supabase requise
          </p>
          <p className="text-xs text-orange-700 mt-1">
            La table <code>room_openings</code> n&apos;existe pas encore.
            Appliquez <code>supabase-migration-room-openings.sql</code> (voir
            aussi <code>MIGRATIONS_A_APPLIQUER.sql</code>) dans le SQL Editor
            de Supabase, puis rechargez cette page.
          </p>
        </div>
      </div>
    );
  }

  const renderFormRow = (
    f: OpeningForm,
    setF: (f: OpeningForm) => void,
    onSubmit: () => void,
    onCancel?: () => void,
  ) => {
    const count = previewCount(f);
    const valid =
      f.room.trim() && f.date && f.startTime < f.endTime && count > 0;
    return (
      <tr className="bg-blue-50/40">
        <td className="px-3 py-2">
          <input
            type="text"
            value={f.room}
            onChange={(e) => setF({ ...f, room: e.target.value })}
            placeholder="Salle"
            className="w-24 border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </td>
        <td className="px-3 py-2">
          <input
            type="date"
            value={f.date}
            min={dateMin || undefined}
            max={dateMax || undefined}
            onChange={(e) => setF({ ...f, date: e.target.value })}
            className="border border-gray-300 rounded-md px-2 py-1.5 text-sm"
          />
        </td>
        <td className="px-3 py-2 whitespace-nowrap">
          <input
            type="time"
            value={f.startTime}
            onChange={(e) => setF({ ...f, startTime: e.target.value })}
            className="border border-gray-300 rounded-md px-2 py-1.5 text-sm"
          />
          <span className="mx-1 text-gray-400">–</span>
          <input
            type="time"
            value={f.endTime}
            onChange={(e) => setF({ ...f, endTime: e.target.value })}
            className="border border-gray-300 rounded-md px-2 py-1.5 text-sm"
          />
        </td>
        <td className="px-3 py-2 whitespace-nowrap">
          <input
            type="time"
            value={f.breakStart}
            onChange={(e) => setF({ ...f, breakStart: e.target.value })}
            className="border border-gray-300 rounded-md px-2 py-1.5 text-sm"
            title="Début de pause (optionnel)"
          />
          <span className="mx-1 text-gray-400">–</span>
          <input
            type="time"
            value={f.breakEnd}
            onChange={(e) => setF({ ...f, breakEnd: e.target.value })}
            className="border border-gray-300 rounded-md px-2 py-1.5 text-sm"
            title="Fin de pause (optionnel)"
          />
        </td>
        <td className="px-3 py-2 text-sm font-medium text-blue-700 whitespace-nowrap">
          → {count} créneau{count > 1 ? "x" : ""}
        </td>
        <td className="px-3 py-2 text-right whitespace-nowrap">
          <button
            onClick={onSubmit}
            disabled={busy || !valid}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {onCancel ? "✓ Enregistrer" : "+ Ajouter"}
          </button>
          {onCancel && (
            <button
              onClick={onCancel}
              className="ml-1 px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700"
            >
              ✕
            </button>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">
            🏢 Ouvertures de salles
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Déclarez vos salles et leurs plages horaires — le système découpe
            automatiquement en créneaux de{" "}
            {sliceParams.durationMinutes + sliceParams.roulementMinutes} min (
            {sliceParams.durationMinutes} min d&apos;épreuve +{" "}
            {sliceParams.roulementMinutes} min de roulement).
          </p>
        </div>
        {openingDates.length > 0 && (
          <button
            onClick={() => {
              setDupSource(openingDates[0]);
              setShowDuplicate(true);
            }}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border text-blue-700 bg-blue-50 border-blue-200 hover:bg-blue-100 transition-colors"
          >
            📋 Dupliquer une journée…
          </button>
        )}
      </div>

      {/* Bandeau résumé */}
      <div className="flex gap-3 flex-wrap">
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
          <div className="text-lg font-bold text-blue-800">{totalSlots}</div>
          <div className="text-[11px] text-blue-600">créneaux générés</div>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2">
          <div className="text-lg font-bold text-green-800">
            {totalSlots * maxCandidatesPerSlot}
          </div>
          <div className="text-[11px] text-green-600">
            capacité candidats totale
          </div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
          <div className="text-lg font-bold text-amber-800">
            {totalOccupied}
          </div>
          <div className="text-[11px] text-amber-700">
            créneaux occupés (protégés 🔒)
          </div>
        </div>
        {allConflicts.length > 0 && (
          <div className="bg-red-50 border-2 border-red-300 rounded-lg px-4 py-2">
            <div className="text-lg font-bold text-red-700">
              {allConflicts.length}
            </div>
            <div className="text-[11px] text-red-600">
              conflit(s) à résoudre
            </div>
          </div>
        )}
      </div>

      {/* Tableau */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 text-gray-500 text-[11px] uppercase tracking-wide">
              <th className="px-3 py-2.5 border-b border-gray-200">Salle</th>
              <th className="px-3 py-2.5 border-b border-gray-200">Date</th>
              <th className="px-3 py-2.5 border-b border-gray-200">
                Horaires
              </th>
              <th className="px-3 py-2.5 border-b border-gray-200">Pause</th>
              <th className="px-3 py-2.5 border-b border-gray-200">
                Créneaux
              </th>
              <th className="px-3 py-2.5 border-b border-gray-200"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-gray-400">
                  Chargement…
                </td>
              </tr>
            ) : (
              <>
                {openings.map((o) => {
                  if (editingId === o.id) {
                    return (
                      <tr key={o.id} className="contents">
                        {
                          renderFormRow(
                            editForm,
                            setEditForm,
                            handleSaveEdit,
                            () => setEditingId(null),
                          ).props.children
                        }
                      </tr>
                    );
                  }
                  const color =
                    ROOM_PALETTE[
                      (roomIndex.get(o.room) || 0) % ROOM_PALETTE.length
                    ];
                  const conflictCount = o.conflicts.length;
                  return (
                    <tr key={o.id} className="hover:bg-gray-50/50">
                      <td className="px-3 py-2.5">
                        <span
                          className="px-2.5 py-0.5 rounded-full text-xs font-semibold"
                          style={{
                            backgroundColor: color.bg,
                            color: color.text,
                          }}
                        >
                          {o.room}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 capitalize">
                        {fmtDate(o.date)}
                      </td>
                      <td className="px-3 py-2.5">
                        {o.start_time} – {o.end_time}
                      </td>
                      <td className="px-3 py-2.5 text-gray-500">
                        {o.break_start
                          ? `${o.break_start} – ${o.break_end}`
                          : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <strong>{o.slots_total}</strong>
                        {o.slots_occupied > 0 && (
                          <span className="text-xs text-gray-400 ml-1">
                            (dont {o.slots_occupied} occupé
                            {o.slots_occupied > 1 ? "s" : ""} 🔒)
                          </span>
                        )}
                        {conflictCount > 0 && (
                          <span className="text-xs text-red-600 font-medium ml-1">
                            · ⚠️ {conflictCount} conflit
                            {conflictCount > 1 ? "s" : ""}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        <button
                          onClick={() => startEdit(o)}
                          className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                        >
                          ✏️ Modifier
                        </button>
                        <button
                          onClick={() => handleDelete(o)}
                          className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 transition-colors ml-1"
                          title="Supprimer l'ouverture"
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {openings.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-5 text-center text-gray-400 text-sm"
                    >
                      Aucune ouverture — ajoutez votre première salle
                      ci-dessous.
                    </td>
                  </tr>
                )}
                {editingId === null &&
                  renderFormRow(form, setForm, handleAdd)}
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* Conflits à résoudre */}
      {allConflicts.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-red-800 mb-2">
            ⚠️ Créneaux occupés hors de leur ouverture — à résoudre
          </p>
          <ul className="space-y-1.5">
            {allConflicts.map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-3 text-sm text-red-900 flex-wrap"
              >
                <span className="capitalize">
                  {fmtDate(c.date)} · {c.start_time} – {c.end_time} ·{" "}
                  {c.room || c.openingRoom}
                </span>
                <span className="flex gap-1">
                  <button
                    onClick={() =>
                      setHiddenConflicts((prev) => new Set(prev).add(c.id))
                    }
                    className="text-xs px-2 py-0.5 rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                  >
                    Garder
                  </button>
                  <button
                    onClick={() => handleDeleteConflictSlot(c.id)}
                    className="text-xs px-2 py-0.5 rounded border border-red-300 bg-white text-red-600 hover:bg-red-100"
                  >
                    Supprimer (notifier)
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Modale duplication */}
      {showDuplicate && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setShowDuplicate(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-gray-900">
              📋 Dupliquer une journée
            </h3>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Journée source (ouvertures à copier)
              </label>
              <select
                value={dupSource}
                onChange={(e) => setDupSource(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                {openingDates.map((d) => (
                  <option key={d} value={d}>
                    {fmtDate(d)} (
                    {openings.filter((o) => o.date === d).length} ouverture
                    {openings.filter((o) => o.date === d).length > 1
                      ? "s"
                      : ""}
                    )
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Journées cibles
              </label>
              <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                {weekdaysInRange
                  .filter((d) => d !== dupSource)
                  .map((d) => {
                    const selected = dupTargets.has(d);
                    return (
                      <button
                        key={d}
                        onClick={() =>
                          setDupTargets((prev) => {
                            const next = new Set(prev);
                            if (selected) next.delete(d);
                            else next.add(d);
                            return next;
                          })
                        }
                        className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors capitalize ${
                          selected
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"
                        }`}
                      >
                        {fmtDate(d)}
                      </button>
                    );
                  })}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setShowDuplicate(false)}
                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
              >
                Annuler
              </button>
              <button
                onClick={handleDuplicate}
                disabled={busy || dupTargets.size === 0}
                className="px-4 py-1.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
              >
                Dupliquer vers {dupTargets.size} journée
                {dupTargets.size > 1 ? "s" : ""}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
