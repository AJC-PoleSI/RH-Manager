"use client";

import { useMemo, useState } from "react";
import api from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import {
  activeEnrollmentCount,
  formatSlotLabel,
  type UnderstaffedSlot,
} from "@/lib/dispatch-understaffing";

/**
 * Bandeau admin : les créneaux qui n'ont pas leur compte d'examinateurs,
 * et le recalcul du planning avec aperçu préalable.
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

/** Aperçu renvoyé par POST /api/dispatch/run avec `dryRun: true`. */
interface DispatchPreview {
  added?: Array<{ slot_id: string; member_id: string }>;
  removed?: Array<{ slot_id: string; member_id: string; reason: string }>;
  understaffedWithCandidates?: UnderstaffedSlot[];
  updated?: number;
  frozen?: number;
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

export default function UnderstaffedBanner({
  slots,
  onRecalculated,
}: {
  slots: SlotLike[];
  /** Rafraîchit la page après un recalcul réel. */
  onRecalculated?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<DispatchPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const { toast } = useToast();

  /**
   * Un recalcul global rebrasse plus de mille créneaux : on montre d'abord ce
   * qui changerait (aucune écriture), l'admin applique ensuite s'il valide.
   */
  const runPreview = async () => {
    setLoading(true);
    try {
      const res = await api.post("/dispatch/run", {
        dryRun: true,
        notifyAll: true,
      });
      setPreview(res.data);
    } catch (e: any) {
      toast(
        e?.response?.data?.error || "Impossible de simuler le recalcul",
        "error",
      );
    } finally {
      setLoading(false);
    }
  };

  const apply = async () => {
    setApplying(true);
    try {
      const res = await api.post("/dispatch/run", {});
      toast(res.data?.message || "Recalcul appliqué", "success");
      setPreview(null);
      onRecalculated?.();
    } catch (e: any) {
      toast(e?.response?.data?.error || "Le recalcul a échoué", "error");
    } finally {
      setApplying(false);
    }
  };

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

  const tone =
    critical.length > 0
      ? {
          border: "border-red-300",
          bg: "bg-red-50",
          title: "text-red-900",
          text: "text-red-800",
        }
      : urgent > 0
        ? {
            border: "border-amber-300",
            bg: "bg-amber-50",
            title: "text-amber-900",
            text: "text-amber-800",
          }
        : {
            border: "border-gray-200",
            bg: "bg-gray-50",
            title: "text-gray-800",
            text: "text-gray-600",
          };

  return (
    <>
      <div className={`rounded-lg border ${tone.border} ${tone.bg} px-4 py-3`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            {urgent > 0 ? (
              <>
                <p className={`text-sm font-semibold ${tone.title}`}>
                  {critical.length > 0 ? "⚠️ " : "🟠 "}
                  {urgent} créneau{urgent > 1 ? "x" : ""} avec candidat inscrit
                  {urgent > 1 ? "s" : ""} n&apos;{urgent > 1 ? "ont" : "a"} pas
                  son compte d&apos;examinateurs
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
                      · {otherCount} autre{otherCount > 1 ? "s" : ""} en
                      sous-effectif sans candidat
                    </span>
                  )}
                </p>
              </>
            ) : (
              <p className="text-sm text-gray-600">
                {otherCount > 0 ? (
                  <>
                    <span className="font-medium text-gray-800">
                      {otherCount}
                    </span>{" "}
                    créneau{otherCount > 1 ? "x" : ""} en sous-effectif, aucun
                    avec candidat inscrit. Ils se repourvoiront au fil des
                    disponibilités.
                  </>
                ) : (
                  <>Tous les créneaux ont leur compte d&apos;examinateurs.</>
                )}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {urgent > 0 && (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className={`text-xs font-medium underline ${tone.title}`}
              >
                {open ? "Masquer le détail" : "Voir le détail"}
              </button>
            )}
            {/* Toujours accessible, même quand tout va bien. */}
            <button
              type="button"
              onClick={runPreview}
              disabled={loading}
              className="text-xs font-medium px-3 py-1.5 rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {loading ? "Simulation…" : "Recalculer tout"}
            </button>
          </div>
        </div>

        {open && urgent > 0 && (
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

      {preview && (
        <PreviewModal
          preview={preview}
          applying={applying}
          onApply={apply}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}

/**
 * Ce que le recalcul changerait, avant de l'appliquer.
 *
 * Un run global rebrasse plus de mille créneaux : le découvrir après coup
 * n'est pas une option. On montre le volume, les retraits (le plus sensible :
 * quelqu'un perd un créneau) et ce qui resterait en sous-effectif malgré le
 * recalcul.
 */
function PreviewModal({
  preview,
  applying,
  onApply,
  onClose,
}: {
  preview: DispatchPreview;
  applying: boolean;
  onApply: () => void;
  onClose: () => void;
}) {
  const added = preview.added || [];
  const removed = preview.removed || [];
  const understaffed = preview.understaffedWithCandidates || [];
  const critical = understaffed.filter((s) => s.assigned === 0);

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-gray-100 flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              Aperçu du recalcul
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              Rien n&apos;a été enregistré. Voici ce qui changerait si vous
              appliquez.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-2xl leading-none text-gray-400 hover:text-gray-600"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto text-sm">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-green-50 border border-green-200 p-3">
              <p className="text-2xl font-semibold text-green-800">
                {added.length}
              </p>
              <p className="text-xs text-green-700">
                affectation(s) ajoutée(s)
              </p>
            </div>
            <div className="rounded-lg bg-red-50 border border-red-200 p-3">
              <p className="text-2xl font-semibold text-red-800">
                {removed.length}
              </p>
              <p className="text-xs text-red-700">affectation(s) retirée(s)</p>
            </div>
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
              <p className="text-2xl font-semibold text-amber-800">
                {understaffed.length}
              </p>
              <p className="text-xs text-amber-700">
                créneau(x) à candidats encore en sous-effectif
              </p>
            </div>
          </div>

          {critical.length > 0 && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3">
              <p className="text-xs font-semibold text-red-900">
                {critical.length} créneau(x) resteraient avec un candidat et
                AUCUN examinateur
              </p>
              <ul className="mt-2 space-y-0.5">
                {critical.slice(0, 10).map((s) => (
                  <li key={s.slotId} className="text-xs text-red-800">
                    {formatSlotLabel(s)}
                  </li>
                ))}
                {critical.length > 10 && (
                  <li className="text-xs text-red-700">
                    … et {critical.length - 10} autre(s)
                  </li>
                )}
              </ul>
            </div>
          )}

          {removed.length > 0 && (
            <div>
              <p className="text-xs uppercase text-gray-400 mb-1.5">
                Retraits ({removed.length})
              </p>
              <ul className="space-y-0.5 max-h-40 overflow-y-auto">
                {removed.slice(0, 50).map((r, i) => (
                  <li key={i} className="text-xs text-gray-700">
                    <span className="text-gray-400">
                      {r.slot_id.slice(0, 8)}
                    </span>{" "}
                    — {r.reason}
                  </li>
                ))}
                {removed.length > 50 && (
                  <li className="text-xs text-gray-400">
                    … et {removed.length - 50} autre(s)
                  </li>
                )}
              </ul>
            </div>
          )}

          {added.length === 0 && removed.length === 0 && (
            <p className="text-sm text-gray-600">
              Le recalcul ne changerait aucune affectation. Le planning est déjà
              aligné sur les disponibilités déclarées.
            </p>
          )}
        </div>

        <div className="p-4 border-t border-gray-100 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="text-sm px-4 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            Annuler
          </button>
          <button
            onClick={onApply}
            disabled={applying}
            className="text-sm px-4 py-2 rounded-md bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {applying ? "Application…" : "Appliquer le recalcul"}
          </button>
        </div>
      </div>
    </div>
  );
}
