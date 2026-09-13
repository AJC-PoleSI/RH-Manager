"use client";

// Composeur d'annonce générale (admin).
//
// Le compteur de destinataires vient du serveur (`dryRun`), pas d'une
// estimation côté client : c'est le même calcul que l'envoi réel, donc le
// chiffre affiché est celui qui partira — indispensable quand le quota
// d'emails du jour est en jeu.

import { useCallback, useEffect, useState } from "react";
import { Megaphone, Loader2, Check, AlertTriangle } from "lucide-react";
import api from "@/lib/api";
import { CANDIDATE_FILTERS, CandidateFilter } from "@/lib/announcements";

interface Preview {
  members: number;
  candidates: number;
  emailRecipients: number;
  emailsSentToday: number;
  dailyCap: number;
  remaining: number;
  overQuota: boolean;
  migrationPending: boolean;
  poles: { pole: string; count: number }[];
}

interface HistoryItem {
  id: string;
  title: string;
  membersCount: number;
  candidatesCount: number;
  emailSent: number;
  emailFailed: number;
  createdByName: string | null;
  createdAt: string;
}

export default function AnnouncementComposer() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [targetMembers, setTargetMembers] = useState(true);
  const [memberPole, setMemberPole] = useState("");
  const [targetCandidates, setTargetCandidates] = useState(false);
  const [candidateFilter, setCandidateFilter] = useState<CandidateFilter>("all");
  const [sendEmail, setSendEmail] = useState(false);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const audience = {
    targetMembers,
    memberPole: memberPole || null,
    targetCandidates,
    candidateFilter,
  };

  const loadHistory = useCallback(async () => {
    try {
      const res = await api.get("/announcements");
      setHistory(res.data?.announcements || []);
    } catch {
      // Silencieux : l'historique est un confort, pas un prérequis.
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Aperçu de l'audience, redemandé à chaque changement de ciblage.
  useEffect(() => {
    if (!targetMembers && !targetCandidates) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await api.post("/announcements", {
          ...audience,
          dryRun: true,
        });
        if (!cancelled) setPreview(res.data);
      } catch {
        if (!cancelled) setPreview(null);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetMembers, memberPole, targetCandidates, candidateFilter]);

  const totalRecipients = preview
    ? preview.members + preview.candidates
    : 0;
  const emailBlocked = sendEmail && !!preview?.overQuota;
  const canSend =
    !!title.trim() &&
    !!body.trim() &&
    totalRecipients > 0 &&
    !emailBlocked &&
    !preview?.migrationPending &&
    !sending;

  const handleSend = async () => {
    if (!canSend || !preview) return;
    const parts = [
      preview.members > 0 ? `${preview.members} membre(s)` : null,
      preview.candidates > 0 ? `${preview.candidates} candidat(s)` : null,
    ].filter(Boolean);
    const emailPart = sendEmail
      ? `\n\nUn email partira aussi à ${preview.emailRecipients} destinataire(s).`
      : "\n\nAucun email : notification dans l'application uniquement.";
    if (!confirm(`Envoyer « ${title.trim()} » à ${parts.join(" et ")} ?${emailPart}`))
      return;

    setSending(true);
    setFeedback(null);
    try {
      const res = await api.post("/announcements", {
        ...audience,
        title: title.trim(),
        body: body.trim(),
        sendEmail,
      });
      const d = res.data;
      setFeedback({
        ok: true,
        text:
          `Annonce envoyée à ${d.members} membre(s) et ${d.candidates} candidat(s).` +
          (d.emailSent || d.emailFailed
            ? ` Emails : ${d.emailSent} envoyé(s)${d.emailFailed ? `, ${d.emailFailed} en échec` : ""}.`
            : ""),
      });
      setTitle("");
      setBody("");
      setSendEmail(false);
      loadHistory();
    } catch (e: any) {
      setFeedback({
        ok: false,
        text: e?.response?.data?.error || "Échec de l'envoi de l'annonce.",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-[10px] p-[18px_20px] mb-[14px]">
      <h2 className="text-base font-semibold text-gray-900 mb-1 flex items-center gap-2">
        <Megaphone size={17} className="text-blue-600" />
        Annonce générale
      </h2>
      <p className="text-sm text-gray-500 mb-4">
        Un message à toute une audience : notification dans l&apos;application
        (cloche pour les membres, bandeau pour les candidats), et email au
        choix.
      </p>

      <div className="space-y-3">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={150}
          placeholder="Titre — ex. Report des entretiens de jeudi"
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={5000}
          rows={5}
          placeholder="Message…"
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
        />

        {/* ---------- Audience ---------- */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="border border-gray-200 rounded-md p-3">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-900">
              <input
                type="checkbox"
                checked={targetMembers}
                onChange={(e) => setTargetMembers(e.target.checked)}
                className="w-4 h-4"
              />
              Membres
            </label>
            <select
              value={memberPole}
              onChange={(e) => setMemberPole(e.target.value)}
              disabled={!targetMembers}
              className="mt-2 w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm disabled:bg-gray-50 disabled:text-gray-400"
            >
              <option value="">Tous les pôles</option>
              {(preview?.poles || []).map((p) => (
                <option key={p.pole} value={p.pole}>
                  {p.pole} ({p.count})
                </option>
              ))}
            </select>
          </div>

          <div className="border border-gray-200 rounded-md p-3">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-900">
              <input
                type="checkbox"
                checked={targetCandidates}
                onChange={(e) => setTargetCandidates(e.target.checked)}
                className="w-4 h-4"
              />
              Candidats
            </label>
            <select
              value={candidateFilter}
              onChange={(e) =>
                setCandidateFilter(e.target.value as CandidateFilter)
              }
              disabled={!targetCandidates}
              className="mt-2 w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm disabled:bg-gray-50 disabled:text-gray-400"
            >
              {CANDIDATE_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* ---------- Compteur ---------- */}
        <div className="text-sm text-gray-600">
          {!targetMembers && !targetCandidates ? (
            <span className="text-amber-700">
              Coche au moins une audience.
            </span>
          ) : preview ? (
            <span>
              <strong className="text-gray-900">{totalRecipients}</strong>{" "}
              destinataire(s) : {preview.members} membre(s), {preview.candidates}{" "}
              candidat(s).
            </span>
          ) : (
            <span className="text-gray-400">Calcul de l&apos;audience…</span>
          )}
        </div>

        {/* ---------- Email ---------- */}
        <div className="border border-gray-200 rounded-md p-3 bg-gray-50">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-900">
            <input
              type="checkbox"
              checked={sendEmail}
              onChange={(e) => setSendEmail(e.target.checked)}
              className="w-4 h-4"
            />
            Envoyer aussi par email
          </label>
          {preview && (
            <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
              {preview.emailRecipients} email(s) à envoyer · quota du jour :{" "}
              {preview.emailsSentToday}/{preview.dailyCap} déjà utilisés,{" "}
              {preview.remaining} restant(s).
              <br />
              Les emails de vérification, résultats et mots de passe oubliés
              consomment le même quota sans être comptés ici.
            </p>
          )}
          {emailBlocked && (
            <p className="text-xs text-red-600 mt-2 flex items-start gap-1.5">
              <AlertTriangle size={14} className="mt-px flex-shrink-0" />
              Trop d&apos;emails pour le quota restant aujourd&apos;hui. Réduis
              l&apos;audience, décoche l&apos;email (l&apos;annonce reste visible
              dans l&apos;app), ou attends demain.
            </p>
          )}
        </div>

        {preview?.migrationPending && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 flex items-start gap-1.5">
            <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
            Les tables d&apos;annonces n&apos;existent pas encore en base :
            applique la section 13 de MIGRATIONS_A_APPLIQUER.sql dans le SQL
            Editor de Supabase. L&apos;audience ci-dessus est déjà exacte.
          </p>
        )}

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

        <button
          onClick={handleSend}
          disabled={!canSend}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
        >
          {sending && <Loader2 size={15} className="animate-spin" />}
          {sending ? "Envoi…" : "Envoyer l'annonce"}
        </button>
      </div>

      {/* ---------- Historique ---------- */}
      {history.length > 0 && (
        <div className="mt-5 pt-4 border-t border-gray-100">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Dernières annonces
          </p>
          <ul className="space-y-1.5">
            {history.slice(0, 5).map((h) => (
              <li key={h.id} className="text-sm text-gray-600 flex gap-2">
                <span className="text-gray-400 whitespace-nowrap">
                  {new Date(h.createdAt).toLocaleDateString("fr-FR", {
                    day: "2-digit",
                    month: "2-digit",
                  })}
                </span>
                <span className="font-medium text-gray-900 truncate">
                  {h.title}
                </span>
                <span className="text-gray-400 whitespace-nowrap ml-auto">
                  {h.membersCount + h.candidatesCount} dest.
                  {h.emailSent ? ` · ${h.emailSent} mails` : ""}
                  {h.emailFailed ? ` · ${h.emailFailed} échecs` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
