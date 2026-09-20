"use client";

import { useEffect, useState } from "react";

/**
 * Éditeur en ligne d'un nombre de places sur un créneau.
 *
 * POURQUOI. Le quota d'examinateurs (`min_members`) et la capacité candidats
 * (`max_candidates`) d'un créneau étaient jusqu'ici en lecture seule : la
 * seule façon de les changer passait par l'épreuve — ce qui répercute la
 * nouvelle valeur sur TOUS ses créneaux (cf. PUT /api/epreuves/[id]). Pour
 * dire « ce business game-là se tiendra à 5 examinateurs » sans toucher aux
 * 88 autres, il fallait pouvoir éditer le créneau lui-même.
 *
 * Le composant ne connaît rien à Supabase : il rend un nombre, propose de le
 * corriger, et rend la main à l'appelant via `onSave`. Les refus serveur
 * (créneau figé, sur-effectif candidats…) restent affichés par l'appelant.
 */
export default function QuotaEditor({
  value,
  onSave,
  title,
  min = 0,
  max = 99,
  disabled = false,
}: {
  /** Valeur actuellement en base. */
  value: number;
  /** Enregistre la nouvelle valeur. Rejette pour laisser l'éditeur ouvert. */
  onSave: (next: number) => Promise<void> | void;
  /** Infobulle du crayon ("Modifier le nombre d'examinateurs requis"). */
  title: string;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const [busy, setBusy] = useState(false);

  // La valeur peut changer sous nos pieds (rafraîchissement de la modale
  // après ajout d'un examinateur) : le brouillon la suit tant qu'on n'édite
  // pas, et repart d'elle à chaque ouverture.
  useEffect(() => {
    if (!open) setDraft(String(value));
  }, [value, open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={title}
        aria-label={title}
        className="text-xs text-gray-400 hover:text-gray-700 px-1.5 py-1 rounded hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        ✏️
      </button>
    );
  }

  const commit = async () => {
    const next = Number(draft);
    if (!Number.isFinite(next) || next < min || next > max) return;
    if (next === value) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      await onSave(next);
      setOpen(false);
    } catch {
      // L'appelant a déjà affiché la raison du refus ; on garde l'éditeur
      // ouvert pour que la valeur saisie ne soit pas perdue.
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="flex items-center gap-1">
      <input
        type="number"
        value={draft}
        min={min}
        max={max}
        autoFocus
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setOpen(false);
        }}
        aria-label={title}
        className="w-14 text-xs border border-gray-300 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      <button
        type="button"
        onClick={commit}
        disabled={busy}
        title="Enregistrer"
        className="text-xs px-1.5 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
      >
        {busy ? "…" : "✓"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        disabled={busy}
        title="Annuler"
        className="text-xs px-1.5 py-1 rounded border border-gray-300 text-gray-500 hover:bg-gray-50 disabled:opacity-40"
      >
        ×
      </button>
    </span>
  );
}
