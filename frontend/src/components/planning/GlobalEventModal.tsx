"use client";

/**
 * GlobalEventModal — créer ou modifier un événement global (visible par tous
 * les candidats) directement depuis le calendrier du Planning : clic sur un
 * jour vide ou sur « + » pour créer, clic sur l'événement pour le modifier.
 *
 * Remplace l'ancien panneau « Événements globaux » (liste + formulaire) qui
 * se trouvait tout en bas de la page. Mêmes routes API qu'avant
 * (POST /calendar, PUT/DELETE /calendar/[id]) : rien ne change côté serveur.
 */

import { useEffect, useState } from "react";
import api from "@/lib/api";

const EVENT_COLORS = [
  { value: "#3B82F6", label: "Bleu" },
  { value: "#10B981", label: "Vert" },
  { value: "#F59E0B", label: "Jaune" },
  { value: "#EF4444", label: "Rouge" },
  { value: "#8B5CF6", label: "Violet" },
  { value: "#EC4899", label: "Rose" },
  { value: "#64748B", label: "Gris" },
];

interface Props {
  /** Événement à modifier ; null = création. */
  event: any | null;
  /** Jour prérempli à la création (YYYY-MM-DD). */
  initialDay: string;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  onClose: () => void;
  /** Appelé après un enregistrement ou une suppression réussis. */
  onSaved: () => void;
}

/** `day` est stocké en ISO (minuit UTC) : on en tire la date AAAA-MM-JJ. */
function isoToDateInput(raw: string | null | undefined): string {
  if (!raw) return "";
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().split("T")[0];
}

export default function GlobalEventModal({
  event,
  initialDay,
  toast,
  onClose,
  onSaved,
}: Props) {
  const editing = !!event;

  const [initial] = useState(() => ({
    title: event?.title || "",
    description: event?.description || "",
    day: event ? isoToDateInput(event.day) : initialDay,
    dayEnd: event ? isoToDateInput(event.day_end) : "",
    startTime: String(event?.start_time || event?.startTime || "09:00").slice(0, 5),
    endTime: String(event?.end_time || event?.endTime || "10:00").slice(0, 5),
    visible: event ? event.visible_to_candidates !== false : true,
    color: event?.color || "#3B82F6",
  }));

  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [day, setDay] = useState(initial.day);
  const [dayEnd, setDayEnd] = useState(initial.dayEnd);
  const [startTime, setStartTime] = useState(initial.startTime);
  const [endTime, setEndTime] = useState(initial.endTime);
  const [visible, setVisible] = useState(initial.visible);
  const [color, setColor] = useState(initial.color);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dirty =
    title !== initial.title ||
    description !== initial.description ||
    day !== initial.day ||
    dayEnd !== initial.dayEnd ||
    startTime !== initial.startTime ||
    endTime !== initial.endTime ||
    visible !== initial.visible ||
    color !== initial.color;

  // Échap ferme, sauf pendant un enregistrement.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const handleSave = async () => {
    if (!title.trim() || !day) {
      toast("Titre et date de début requis", "error");
      return;
    }
    if (dayEnd && dayEnd < day) {
      toast("La date de fin précède la date de début", "error");
      return;
    }
    setBusy("save");
    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      day,
      day_end: dayEnd || null,
      start_time: startTime,
      end_time: endTime,
      visible_to_candidates: visible,
      color,
    };
    try {
      if (editing) {
        await api.put(`/calendar/${event.id}`, payload);
        toast("Événement mis à jour", "success");
      } else {
        await api.post("/calendar", { ...payload, is_global: true });
        toast(
          "Événement créé" +
            (visible
              ? " et visible par tous les candidats"
              : " (masqué pour les candidats)"),
          "success",
        );
      }
      onSaved();
      onClose();
    } catch (err: any) {
      toast(err?.response?.data?.error || "Erreur sauvegarde événement", "error");
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    setBusy("delete");
    try {
      await api.delete(`/calendar/${event.id}`);
      toast("Événement supprimé", "success");
      onSaved();
      onClose();
    } catch {
      toast("Erreur suppression", "error");
      setBusy(null);
      setConfirmDelete(false);
    }
  };

  const inputClass =
    "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      // Un clic à côté ne doit pas faire perdre une saisie en cours.
      onClick={() => {
        if (!busy && !dirty) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="global-event-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 bg-blue-50 px-5 py-4">
          <h2
            id="global-event-title"
            className="text-base font-semibold text-blue-900"
          >
            {editing ? "✏️ Modifier l'événement" : "📌 Nouvel événement"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={!!busy}
            aria-label="Fermer"
            className="text-2xl leading-none text-gray-400 hover:text-gray-700 disabled:opacity-50"
          >
            ×
          </button>
        </div>

        <div className="space-y-3 p-5">
          <div>
            <label
              htmlFor="ge-title"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Titre *
            </label>
            <input
              id="ge-title"
              type="text"
              autoFocus={!editing}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
              placeholder="Ex : Réunion d'information, date limite de rendu…"
            />
          </div>

          <div>
            <label
              htmlFor="ge-desc"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Description
            </label>
            <textarea
              id="ge-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputClass}
              rows={2}
              placeholder="Détails de l'événement (optionnel)"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="ge-day"
                className="mb-1 block text-sm font-medium text-gray-700"
              >
                Date début *
              </label>
              <input
                id="ge-day"
                type="date"
                value={day}
                onChange={(e) => setDay(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label
                htmlFor="ge-day-end"
                className="mb-1 block text-sm font-medium text-gray-700"
              >
                Date fin
              </label>
              <input
                id="ge-day-end"
                type="date"
                value={dayEnd}
                onChange={(e) => setDayEnd(e.target.value)}
                min={day || undefined}
                className={inputClass}
              />
              <p className="mt-0.5 text-[10px] text-gray-400">
                Vide = une seule journée
              </p>
            </div>
            <div>
              <label
                htmlFor="ge-start"
                className="mb-1 block text-sm font-medium text-gray-700"
              >
                Heure début
              </label>
              <input
                id="ge-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label
                htmlFor="ge-end"
                className="mb-1 block text-sm font-medium text-gray-700"
              >
                Heure fin
              </label>
              <input
                id="ge-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className={inputClass}
              />
              {dayEnd && (
                <p className="mt-0.5 text-[10px] text-gray-400">
                  Horaire répété chaque jour
                </p>
              )}
            </div>
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium text-gray-700">
              Couleur
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {EVENT_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setColor(c.value)}
                  title={c.label}
                  aria-label={c.label}
                  aria-pressed={color === c.value}
                  className={`h-8 w-8 rounded-full border-2 transition-transform ${
                    color === c.value
                      ? "scale-110 border-gray-900 shadow-sm"
                      : "border-transparent hover:scale-105"
                  }`}
                  style={{ backgroundColor: c.value }}
                />
              ))}
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
            <span className="relative inline-flex items-center">
              <input
                type="checkbox"
                checked={visible}
                onChange={(e) => setVisible(e.target.checked)}
                className="peer sr-only"
              />
              <span className="h-5 w-9 rounded-full bg-gray-300 transition-colors peer-checked:bg-blue-600 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-400 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-4" />
            </span>
            <span>
              <span className="block text-sm font-medium text-gray-800">
                {visible ? "👁️ Visible" : "🙈 Masqué"} pour les candidats
              </span>
              <span className="block text-xs text-gray-500">
                {visible
                  ? "Les candidats verront cet événement dans leur calendrier"
                  : "Cet événement ne sera pas visible par les candidats"}
              </span>
            </span>
          </label>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-5 py-4">
          <div>
            {editing &&
              (confirmDelete ? (
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={!!busy}
                    className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {busy === "delete" ? "Suppression…" : "Confirmer"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    disabled={!!busy}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                  >
                    Non
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  disabled={!!busy}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  🗑️ Supprimer
                </button>
              ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={!!busy}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!!busy}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy === "save"
                ? "Enregistrement…"
                : editing
                  ? "Mettre à jour"
                  : "Publier l'événement"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
