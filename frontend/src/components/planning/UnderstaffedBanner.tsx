"use client";

import { useMemo, useState } from "react";
import { activeEnrollmentCount, formatSlotLabel, type UnderstaffedSlot } from "@/lib/dispatch-understaffing";

/**
 * Bandeau admin : les créneaux qui n'ont pas leur compte d'examinateurs.
 *
 * POURQUOI. Un créneau en sous-effectif était jusqu'ici rétrogradé en `open`
 * sans le moindre signal : il sortait de la liste de réservation et personne
 * n'en était averti. Au 11/09/2026, 648 créneaux étaient dans ce cas, dont 8
 * avec un candidat DÉJÀ inscrit — et 6 d'entre eux sans aucun examinateur.
 *
 * Le bandeau hiérarchise ce que l'admin doit traiter :
 *   1. CRITIQUE — un candidat est inscrit et AUCUN examinateur n'est affecté :
 *      le rendez-vous ne peut pas se tenir.
 *   2. À COMPLÉTER — un candidat est inscrit et il manque un examinateur : le
 *      créneau se tient, mais à un seul.
 *   3. Le reste (sans candidat) n'est qu'un compteur : ces créneaux retournent
 *      au pool et se repourvoiront d'eux-mêmes.
 */

/** Forme d'un créneau telle que la page planning la manipule (snake ou camel). */
export interface SlotLike {
  id: string;
  date?: string | null;
  start_time?: string | null;
  startTime?: string | null;
  room?: string | null;
  min_members?: number | null;
  minMembers?: number | null;
  members?: Array<unknown> | null;
  enrollments?: Array<{ status?: string | null }> | null;
}

function toUnderstaffed(slot: SlotLike): UnderstaffedSlot | null {
  const needed = slot.min_members || slot.minMembers || 2;
  const assigned = (slot.members || []).length;
  if (assigned >= needed) return null;
  return {
    slotId: slot.id,
    date: String(slot.date || ""),
    startTime: String(slot.start_time || slot.startTime || ""),
    room: slot.room ?? null,
    assigned,
    needed,
    candidates: activeEnrollmentCount(slot.enrollments),
  };
}

export default function UnderstaffedBanner({ slots }: { slots: SlotLike[] }) {
  const [open, setOpen] = useState(false);

  const { critical, partial, otherCount } = useMemo(() => {
    const all = (slots || [])
      .map(toUnderstaffed)
      .filter((s): s is UnderstaffedSlot => s !== null);

    const withCandidates = all.filter((s) => s.candidates > 0);
    return {
      critical: withCandidates.filter((s) => s.assigned === 0),
      partial: withCandidates.filter((s) => s.assigned >= 1),
      otherCount: all.length - withCandidates.length,
    };
  }, [slots]);

  const urgent = critical.length + partial.length;
  if (urgent === 0 && otherCount === 0) return null;

  // Aucun créneau à candidats concerné : simple compteur discret, rien à faire
  // dans l'immédiat.
  if (urgent === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-600">
        <span className="font-medium text-gray-800">{otherCount}</span> créneau
        {otherCount > 1 ? "x" : ""} en sous-effectif, aucun avec candidat
        inscrit. Ils se repourvoiront au fil des disponibilités.
      </div>
    );
  }

  const tone = critical.length > 0
    ? { border: "border-red-300", bg: "bg-red-50", title: "text-red-900", text: "text-red-800" }
    : { border: "border-amber-300", bg: "bg-amber-50", title: "text-amber-900", text: "text-amber-800" };

  return (
    <div className={`rounded-lg border ${tone.border} ${tone.bg} px-4 py-3`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className={`text-sm font-semibold ${tone.title}`}>
            {critical.length > 0 ? "⚠️ " : "🟠 "}
            {urgent} créneau{urgent > 1 ? "x" : ""} avec candidat inscrit
            {urgent > 1 ? "s" : ""} n&apos;{urgent > 1 ? "ont" : "a"} pas son
            compte d&apos;examinateurs
          </p>
          <p className={`text-xs mt-1 ${tone.text}`}>
            {critical.length > 0 && (
              <span className="font-semibold">
                {critical.length} sans aucun examinateur
              </span>
            )}
            {critical.length > 0 && partial.length > 0 && " · "}
            {partial.length > 0 && (
              <span>{partial.length} à un seul examinateur</span>
            )}
            {otherCount > 0 && (
              <span className="text-gray-500">
                {" "}
                · {otherCount} autre{otherCount > 1 ? "s" : ""} en sous-effectif
                sans candidat
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`text-xs font-medium underline ${tone.title} shrink-0`}
        >
          {open ? "Masquer le détail" : "Voir le détail"}
        </button>
      </div>

      {open && (
        <ul className="mt-3 space-y-1 max-h-56 overflow-y-auto">
          {[...critical, ...partial].map((s) => (
            <li
              key={s.slotId}
              className="text-xs flex items-center gap-2 flex-wrap"
            >
              <span
                className={`inline-block px-1.5 py-0.5 rounded font-semibold ${
                  s.assigned === 0
                    ? "bg-red-600 text-white"
                    : "bg-amber-500 text-white"
                }`}
              >
                {s.assigned}/{s.needed}
              </span>
              <span className={tone.text}>{formatSlotLabel(s)}</span>
              <span className="text-gray-500">
                · {s.candidates} candidat{s.candidates > 1 ? "s" : ""} inscrit
                {s.candidates > 1 ? "s" : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
