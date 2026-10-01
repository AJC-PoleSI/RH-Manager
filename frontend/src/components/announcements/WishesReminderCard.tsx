"use client";

// Carte « Relance des vœux de pôle » (admin), à côté du composeur d'annonces.
//
// Les compteurs viennent du serveur (`dryRun`), pas d'une estimation côté
// client : c'est le même calcul que l'envoi réel ET que le cron du matin,
// donc le chiffre affiché est celui qui partira. Le bouton sert au premier
// envoi (sur feu vert explicite) et aux relances hors horaire ; le cron fait
// le reste chaque matin à 8 h.

import { useCallback, useEffect, useState } from "react";
import { BellRing, Loader2, Check, AlertTriangle } from "lucide-react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { WISHES_REMINDER_INTERVAL_DAYS } from "@/lib/wishes-reminder";

interface Preview {
  migrationPending: boolean;
  total: number;
  toSend: number;
  remaining: number;
  emailsSentToday: number;
  dailyCap: number;
  sent: number;
  failed: number;
}

export default function WishesReminderCard() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.post("/admin/wishes-reminder", { dryRun: true });
      setPreview(res.data);
    } catch (e: any) {
      setPreview(null);
      setFeedback({
        ok: false,
        text:
          e?.response?.data?.error ||
          "Impossible de calculer la relance des vœux.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const canSend =
    !!preview && !preview.migrationPending && preview.toSend > 0 && !sending;

  const handleSend = async () => {
    if (!canSend || !preview) return;
    if (
      !confirm(
        `Envoyer maintenant la relance à ${preview.toSend} candidat(s) sans vœux ?\n\n` +
          `Un email part à chacun ; ils ne seront pas relancés à nouveau avant ${WISHES_REMINDER_INTERVAL_DAYS} jours.`,
      )
    )
      return;

    setSending(true);
    setFeedback(null);
    try {
      const res = await api.post("/admin/wishes-reminder", { dryRun: false });
      const d: Preview = res.data;
      setFeedback({
        ok: d.failed === 0,
        text:
          `Relance envoyée : ${d.sent} email(s) parti(s)` +
          (d.failed ? `, ${d.failed} en échec (ces candidats repasseront au prochain envoi)` : "") +
          ".",
      });
      await load();
    } catch (e: any) {
      setFeedback({
        ok: false,
        text: e?.response?.data?.error || "Échec de l'envoi de la relance.",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-[10px] p-[18px_20px] mb-[14px]">
      <h2 className="text-base font-semibold text-gray-900 mb-1 flex items-center gap-2">
        <BellRing size={17} className="text-indigo-600" />
        Relance des vœux de pôle
      </h2>
      <p className="text-sm text-gray-500 mb-4">
        Rappel par email aux admis au tour 1 encore en lice qui n&apos;ont
        rempli aucun vœu. Envoi automatique chaque matin à 8 h ; un candidat
        n&apos;est pas relancé plus d&apos;une fois tous les{" "}
        {WISHES_REMINDER_INTERVAL_DAYS} jours.
      </p>

      <div className="space-y-3">
        {loading ? (
          <p className="text-sm text-gray-400">Calcul de la relance…</p>
        ) : preview?.migrationPending ? (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 flex items-start gap-1.5">
            <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
            <span>
              La colonne <code>candidates.wishes_reminded_at</code> n&apos;existe
              pas encore en base : applique{" "}
              <code>supabase-migration-wishes-reminder.sql</code> dans le SQL
              Editor de Supabase. Aucune relance ne part tant qu&apos;elle
              manque — sinon tous les candidats seraient relancés chaque
              matin.
            </span>
          </p>
        ) : preview ? (
          <div className="text-sm text-gray-600">
            <p>
              <strong className="text-gray-900">{preview.total}</strong>{" "}
              candidat(s) sans vœux ({preview.toSend} envoyable(s)
              aujourd&apos;hui)
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Quota du jour : {preview.emailsSentToday}/{preview.dailyCap} déjà
              utilisés, {preview.remaining} restant(s).
            </p>
            {preview.total > preview.toSend && (
              <p className="text-xs text-amber-700 mt-1">
                Les {preview.total - preview.toSend} autre(s) seront relancés
                les jours suivants, quota oblige.
              </p>
            )}
          </div>
        ) : null}

        {feedback && (
          <p
            className={`text-sm flex items-start gap-1.5 ${feedback.ok ? "text-emerald-700" : "text-red-600"}`}
          >
            {feedback.ok ? (
              <Check size={15} className="mt-0.5 flex-shrink-0" />
            ) : (
              <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
            )}
            {feedback.text}
          </p>
        )}

        <Button
          type="button"
          size="sm"
          onClick={handleSend}
          disabled={!canSend}
          className="inline-flex items-center gap-2"
        >
          {sending && <Loader2 size={15} className="animate-spin" />}
          {sending ? "Envoi…" : "Envoyer la relance maintenant"}
        </Button>
      </div>
    </div>
  );
}
