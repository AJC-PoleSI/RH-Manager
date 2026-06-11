"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import api from "@/lib/api";
import { useToast } from "@/components/ui/toast";

interface PoleMember {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  creneauxAssignes: number;
}

interface PoleObligation {
  pole: string;
  candidatsCount: number;
  membresCount: number;
  membres: PoleMember[];
  creneauxRequis: number;
  creneauxParMembre: number;
  creneauxOuverts: number;
}

interface MyObligation {
  pole: string;
  creneauxRequis: number;
  creneauxParMembre: number;
  membresCount: number;
  candidatsCount: number;
  mesCreneaux: number;
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const color =
    pct >= 100 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
      <div
        className={`h-full ${color} transition-all`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function Tour3Page() {
  const { user, role } = useAuth();
  const { toast } = useToast();
  const isAdmin = role === "member" && user?.isAdmin;

  const [obligations, setObligations] = useState<PoleObligation[]>([]);
  const [myObligation, setMyObligation] = useState<MyObligation | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedPole, setExpandedPole] = useState<string | null>(null);
  const [notifying, setNotifying] = useState<string | null>(null);

  const fetchObligations = useCallback(async () => {
    try {
      const res = await api.get("/tour3/obligations");
      setObligations(res.data?.obligations || []);
      setMyObligation(res.data?.myObligation || null);
    } catch (e) {
      console.error("Erreur chargement obligations:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchObligations();
  }, [fetchObligations]);

  const handleNotify = async (pole: string) => {
    setNotifying(pole);
    try {
      const res = await api.post("/tour3/notify", { pole });
      toast(
        `Pôle ${pole} : ${res.data.notified} membre${res.data.notified > 1 ? "s" : ""} notifié${res.data.notified > 1 ? "s" : ""}, ${res.data.emailed} email${res.data.emailed > 1 ? "s" : ""} envoyé${res.data.emailed > 1 ? "s" : ""}.`,
        "success",
      );
    } catch (e: any) {
      toast(
        e?.response?.data?.error || "Erreur lors de l'envoi des notifications",
        "error",
      );
    } finally {
      setNotifying(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  // ── Vue membre : ma progression Tour 3 ──
  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            Tour 3 — Mon pôle
          </h1>
          <p className="text-gray-500 mt-1">
            Vos entretiens à assurer pour les candidats de votre pôle
          </p>
        </div>

        {!myObligation ? (
          <div className="bg-white border rounded-xl p-8 text-center text-gray-400">
            Aucune obligation pour l&apos;instant : soit vous n&apos;êtes
            rattaché à aucun pôle, soit aucun candidat n&apos;a demandé votre
            pôle.
          </div>
        ) : (
          <div className="bg-white border rounded-xl p-6 space-y-5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="text-lg font-semibold text-gray-900">
                  Pôle {myObligation.pole}
                </p>
                <p className="text-sm text-gray-500">
                  {myObligation.candidatsCount} candidat
                  {myObligation.candidatsCount > 1 ? "s" : ""} ·{" "}
                  {myObligation.membresCount} membre
                  {myObligation.membresCount > 1 ? "s" : ""} dans le pôle
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-blue-600">
                  {myObligation.mesCreneaux} / {myObligation.creneauxParMembre}
                </p>
                <p className="text-[11px] text-gray-400">
                  créneaux assurés / minimum requis
                </p>
              </div>
            </div>

            <ProgressBar
              value={myObligation.mesCreneaux}
              max={myObligation.creneauxParMembre}
            />

            {myObligation.mesCreneaux >= myObligation.creneauxParMembre ? (
              <p className="text-sm text-emerald-600 font-medium">
                ✅ Quota atteint — merci !
              </p>
            ) : (
              <p className="text-sm text-amber-600 font-medium">
                Il vous reste{" "}
                {myObligation.creneauxParMembre - myObligation.mesCreneaux}{" "}
                créneau
                {myObligation.creneauxParMembre - myObligation.mesCreneaux > 1
                  ? "x"
                  : ""}{" "}
                à assurer.
              </p>
            )}

            <a
              href="/dashboard/planning"
              className="inline-block bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              Choisir mes créneaux
            </a>
          </div>
        )}
      </div>
    );
  }

  // ── Vue admin : suivi de tous les pôles + notification ──
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            Tour 3 — Suivi des pôles
          </h1>
          <p className="text-gray-500 mt-1">
            Demandes des candidats, quotas et progression des examinateurs par
            pôle
          </p>
        </div>
        <button
          onClick={fetchObligations}
          className="text-sm text-gray-600 border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors"
        >
          ↻ Actualiser
        </button>
      </div>

      {obligations.length === 0 ? (
        <div className="bg-white border rounded-xl p-8 text-center text-gray-400">
          Aucun vœu de pôle enregistré pour l&apos;instant.
        </div>
      ) : (
        <div className="space-y-4">
          {obligations.map((o) => {
            const membersOk = o.membres.filter(
              (m) => m.creneauxAssignes >= o.creneauxParMembre,
            ).length;
            const expanded = expandedPole === o.pole;
            return (
              <div
                key={o.pole}
                className="bg-white border rounded-xl overflow-hidden"
              >
                <div className="p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900">{o.pole}</p>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {o.candidatsCount} candidat
                      {o.candidatsCount > 1 ? "s" : ""} · {o.membresCount}{" "}
                      membre{o.membresCount > 1 ? "s" : ""} · min{" "}
                      {o.creneauxParMembre} créneau
                      {o.creneauxParMembre > 1 ? "x" : ""}/membre
                    </p>
                    <div className="mt-2 max-w-sm">
                      <ProgressBar value={membersOk} max={o.membresCount} />
                      <p className="text-[11px] text-gray-400 mt-1">
                        {membersOk}/{o.membresCount} membre
                        {o.membresCount > 1 ? "s" : ""} à jour ·{" "}
                        {o.creneauxOuverts} créneau
                        {o.creneauxOuverts > 1 ? "x" : ""} ouvert
                        {o.creneauxOuverts > 1 ? "s" : ""} pour ce pôle
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() =>
                        setExpandedPole(expanded ? null : o.pole)
                      }
                      className="text-sm text-gray-600 border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors"
                    >
                      {expanded ? "Masquer" : "Détails"}
                    </button>
                    <button
                      onClick={() => handleNotify(o.pole)}
                      disabled={
                        notifying === o.pole ||
                        o.candidatsCount === 0 ||
                        o.membresCount === 0
                      }
                      className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
                    >
                      {notifying === o.pole
                        ? "Envoi…"
                        : "🔔 Notifier les membres"}
                    </button>
                  </div>
                </div>

                {expanded && (
                  <div className="border-t border-gray-100 px-5 py-4">
                    {o.membres.length === 0 ? (
                      <p className="text-sm text-gray-400 italic">
                        Aucun membre dans ce pôle.
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left min-w-[480px]">
                          <thead>
                            <tr className="text-xs text-gray-400 uppercase">
                              <th className="py-2 pr-4 font-medium">Membre</th>
                              <th className="py-2 pr-4 font-medium">
                                Créneaux assurés
                              </th>
                              <th className="py-2 font-medium">Statut</th>
                            </tr>
                          </thead>
                          <tbody>
                            {o.membres.map((m) => {
                              const ok =
                                m.creneauxAssignes >= o.creneauxParMembre;
                              return (
                                <tr
                                  key={m.id}
                                  className="border-t border-gray-50"
                                >
                                  <td className="py-2.5 pr-4 text-gray-800">
                                    {`${m.firstName} ${m.lastName}`.trim() ||
                                      m.email}
                                  </td>
                                  <td className="py-2.5 pr-4 text-gray-600">
                                    {m.creneauxAssignes} /{" "}
                                    {o.creneauxParMembre}
                                  </td>
                                  <td className="py-2.5">
                                    {ok ? (
                                      <span className="text-xs font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                                        À jour
                                      </span>
                                    ) : (
                                      <span className="text-xs font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                                        En retard
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
