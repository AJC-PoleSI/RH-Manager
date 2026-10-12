"use client";

import { useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Users, ClipboardCheck, Award, UserCheck } from "lucide-react";

interface KPIData {
  totalCandidates: number;
  totalEvaluations: number;
  totalEpreuves: number;
  totalMembers: number;
  /** Tours qui ont au moins une épreuve : alimente le filtre de la page. */
  availableTours?: number[];
  evaluationsPerMember: {
    memberId: string;
    _count: { id: number };
    /** Identité de l'évaluateur (null si le membre a été supprimé depuis). */
    member?: {
      firstName: string;
      lastName: string;
      email: string;
      pole: string | null;
    } | null;
  }[];
}

interface EpreuveSlotStats {
  epreuveId: string;
  name: string;
  tour: number | null;
  totalSlots: number;
  readySlots: number;
  candidatsInscrits: number;
}

interface SlotsKPIData {
  epreuves: EpreuveSlotStats[];
  totals: {
    totalSlots: number;
    readySlots: number;
    candidatsInscrits: number;
    /** Candidats distincts (un candidat inscrit à 2 épreuves compte une fois). */
    candidatsDistincts?: number;
  };
  parTour?: Record<string, { candidatsDistincts: number }>;
}

export default function KPIsPage() {
  const [data, setData] = useState<KPIData | null>(null);
  const [slotsData, setSlotsData] = useState<SlotsKPIData | null>(null);
  const [slotsError, setSlotsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  // Tour dont les chiffres sont à l'écran (null = tous). `pendingTour` est le
  // choix en cours de chargement : le bouton réagit tout de suite, mais les
  // chiffres ne changent d'étiquette qu'une fois ceux du nouveau tour reçus.
  const [tour, setTour] = useState<number | null>(null);
  const [pendingTour, setPendingTour] = useState<{ tour: number | null } | null>(
    null,
  );
  const [tourError, setTourError] = useState(false);
  const tourRequest = useRef(0);

  useEffect(() => {
    const fetchKPIs = async () => {
      // Deux requêtes indépendantes : si /kpis/creneaux échoue, ça ne doit
      // pas faire disparaître le reste de la page (Promise.all propageait
      // l'erreur de l'une à l'autre).
      const [globalRes, slotsRes] = await Promise.allSettled([
        api.get("/kpis/global"),
        api.get("/kpis/creneaux"),
      ]);

      if (globalRes.status === "fulfilled") {
        setData(globalRes.value.data);
      } else if (globalRes.reason?.response?.status === 403) {
        // Les statistiques de pilotage sont réservées aux admins : on le dit,
        // plutôt que d'afficher une erreur de chargement trompeuse.
        setForbidden(true);
      } else {
        console.error(globalRes.reason);
      }

      if (slotsRes.status === "fulfilled") {
        setSlotsData(slotsRes.value.data);
      } else {
        // Visible plutôt que silencieux : un bloqueur de pub ou une panne
        // réseau sur cette seule requête ne doit pas juste faire disparaître
        // la carte sans explication.
        console.error(slotsRes.reason);
        setSlotsError(true);
      }

      setLoading(false);
    };
    fetchKPIs();
  }, []);

  // Changement de tour : seules les statistiques « globales » dépendent du
  // tour côté serveur ; les créneaux sont déjà là et se filtrent à l'écran.
  // Si la requête échoue, on garde le tour précédent et ses chiffres plutôt
  // que d'afficher ceux d'un autre tour sous la mauvaise étiquette.
  const selectTour = async (next: number | null) => {
    if (next === (pendingTour ? pendingTour.tour : tour)) return;
    const id = ++tourRequest.current;
    setPendingTour({ tour: next });
    setTourError(false);
    try {
      const res = await api.get(
        "/kpis/global",
        next === null ? undefined : { params: { tour: next } },
      );
      if (id !== tourRequest.current) return;
      setData(res.data);
      setTour(next);
    } catch (e) {
      if (id !== tourRequest.current) return;
      console.error(e);
      setTourError(true);
    } finally {
      if (id === tourRequest.current) setPendingTour(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="animate-spin text-primary-500" size={32} />
      </div>
    );
  }

  if (forbidden) {
    return (
      <p className="text-gray-500 text-center p-12">
        Ces statistiques sont réservées aux administrateurs.
      </p>
    );
  }

  if (!data) {
    return (
      <p className="text-gray-500 text-center p-12">
        Impossible de charger les statistiques.
      </p>
    );
  }

  const tourOptions =
    data.availableTours ??
    Array.from(
      new Set(
        (slotsData?.epreuves ?? [])
          .map((e) => e.tour)
          .filter((t): t is number => t !== null),
      ),
    ).sort((a, b) => a - b);
  const highlightedTour = pendingTour ? pendingTour.tour : tour;

  // Créneaux & inscriptions : la liste complète est déjà chargée, le filtre
  // se fait ici. Les candidats « distincts » viennent du serveur (un candidat
  // inscrit à deux épreuves ne compte qu'une fois).
  const slotRows = (slotsData?.epreuves ?? []).filter(
    (ep) => tour === null || ep.tour === tour,
  );
  const slotTotals = slotRows.reduce(
    (acc, ep) => ({
      totalSlots: acc.totalSlots + ep.totalSlots,
      readySlots: acc.readySlots + ep.readySlots,
      inscriptions: acc.inscriptions + ep.candidatsInscrits,
    }),
    { totalSlots: 0, readySlots: 0, inscriptions: 0 },
  );
  const distinctCandidates =
    tour === null
      ? slotsData?.totals.candidatsDistincts
      : slotsData
        ? (slotsData.parTour?.[String(tour)]?.candidatsDistincts ?? 0)
        : undefined;

  const stats: {
    label: string;
    value: number | string;
    icon: typeof Users;
    color: string;
  }[] = [
    {
      label: tour === null ? "Candidats" : "Candidats inscrits",
      value:
        tour === null ? data.totalCandidates : (distinctCandidates ?? "—"),
      icon: Users,
      color: "text-blue-600 bg-blue-100",
    },
    {
      label: "Évaluations",
      value: data.totalEvaluations,
      icon: ClipboardCheck,
      color: "text-green-600 bg-green-100",
    },
    {
      label: "Épreuves",
      value: data.totalEpreuves,
      icon: Award,
      color: "text-purple-600 bg-purple-100",
    },
    {
      label: "Membres",
      value: data.totalMembers,
      icon: UserCheck,
      color: "text-orange-600 bg-orange-100",
    },
  ];

  // Anciennement un histogramme plein écran aux barres anonymes
  // (« Membre 1, Membre 2… ») : illisible et très encombrant. Tableau dense
  // et nommé à la place, la barre servant juste d'échelle visuelle.
  const evaluatorRows = data.evaluationsPerMember.map((item) => {
    const m = item.member;
    const fullName = m
      ? `${m.firstName || ""} ${m.lastName || ""}`.trim() || m.email
      : "Membre supprimé";
    return {
      id: item.memberId,
      name: fullName,
      pole: m?.pole || null,
      evaluations: item._count.id,
    };
  });
  const maxEvaluations = Math.max(
    1,
    ...evaluatorRows.map((r) => r.evaluations),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Statistiques (KPIs)</h1>
          <p className="text-gray-500">
            Vue d&apos;ensemble des performances du recrutement.
          </p>
        </div>
        {/* Filtre par tour : « Tous » ou un tour précis. */}
        <div className="flex items-center gap-2">
          {pendingTour && (
            <Loader2 className="animate-spin text-gray-400" size={16} />
          )}
          <div
            role="group"
            aria-label="Filtrer par tour"
            className="flex rounded-full bg-gray-100 p-0.5"
          >
            {[null, ...tourOptions].map((t) => (
              <button
                key={t ?? "all"}
                type="button"
                aria-pressed={highlightedTour === t}
                onClick={() => selectTour(t)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  highlightedTour === t
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {t === null ? "Tous" : `Tour ${t}`}
              </button>
            ))}
          </div>
        </div>
      </div>
      {tourError && (
        <p className="text-sm text-red-600">
          Impossible de charger les chiffres de ce tour. Les statistiques
          affichées sont celles du filtre précédent — réessaie.
        </p>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-4 sm:p-6">
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-lg ${stat.color}`}>
                  <stat.icon size={24} />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stat.value}</p>
                  <p className="text-sm text-gray-500">{stat.label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {tour !== null && evaluatorRows.length === 0 && (
        <Card>
          <CardContent className="p-4 text-sm text-gray-500">
            Aucune évaluation saisie sur le tour {tour} pour le moment.
          </CardContent>
        </Card>
      )}

      {evaluatorRows.length > 0 && (
        <Card>
          <CardHeader className="p-4 pb-1">
            <CardTitle className="text-base">
              Évaluations par membre{tour !== null ? ` — tour ${tour}` : ""}
            </CardTitle>
            <p className="text-xs text-gray-500">
              {evaluatorRows.length} membre
              {evaluatorRows.length > 1 ? "s" : ""} ayant noté · une note
              partagée compte pour ses deux examinateurs
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {/* Liste dense et scrollable : la page reste lisible même avec
                25 évaluateurs, là où l'histogramme prenait tout l'écran. */}
            <div className="max-h-56 overflow-y-auto -mx-2 px-2">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100">
                  {evaluatorRows.map((row) => (
                    <tr key={row.id}>
                      <td className="py-1 pr-3 align-middle">
                        <span className="font-medium text-gray-900">
                          {row.name}
                        </span>
                        {row.pole && (
                          <span className="ml-2 hidden text-xs text-gray-400 sm:inline">
                            {row.pole}
                          </span>
                        )}
                      </td>
                      <td className="py-1 w-1/2 align-middle">
                        <div className="h-2 w-full rounded-full bg-gray-100">
                          <div
                            className="h-2 rounded-full bg-indigo-500"
                            style={{
                              width: `${Math.round((row.evaluations / maxEvaluations) * 100)}%`,
                            }}
                          />
                        </div>
                      </td>
                      <td className="py-1 pl-3 text-right font-semibold text-gray-700 tabular-nums w-12 align-middle">
                        {row.evaluations}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {slotsError && (
        <Card>
          <CardHeader>
            <CardTitle>Créneaux &amp; inscriptions par épreuve</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-500">
              Impossible de charger ces statistiques (bloqueur de publicité ou
              problème réseau ?). Réessaie de recharger la page.
            </p>
          </CardContent>
        </Card>
      )}

      {slotsData && (
        <Card>
          <CardHeader>
            <CardTitle>Créneaux &amp; inscriptions par épreuve</CardTitle>
            <p className="text-sm text-gray-500">
              {slotTotals.readySlots} créneaux prêts sur {slotTotals.totalSlots}{" "}
              · {slotTotals.inscriptions} inscription
              {slotTotals.inscriptions > 1 ? "s" : ""}
              {distinctCandidates !== undefined
                ? ` (${distinctCandidates} candidat${distinctCandidates > 1 ? "s" : ""})`
                : ""}
              {tour !== null ? ` · tour ${tour}` : ""}.
            </p>
          </CardHeader>
          <CardContent>
            {slotRows.length === 0 ? (
              <p className="text-sm text-gray-500">
                {tour === null
                  ? "Aucun créneau rattaché à une épreuve pour le moment."
                  : `Aucun créneau rattaché à une épreuve du tour ${tour}.`}
              </p>
            ) : (
              <div className="scroll-x">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="py-2 pr-4 font-medium">Épreuve</th>
                      <th className="py-2 pr-4 font-medium">Tour</th>
                      <th className="py-2 pr-4 font-medium">Créneaux prêts</th>
                      <th className="py-2 font-medium">Candidats inscrits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slotRows.map((ep) => (
                      <tr key={ep.epreuveId} className="border-b last:border-0">
                        <td className="py-2 pr-4">{ep.name}</td>
                        <td className="py-2 pr-4">{ep.tour ?? "—"}</td>
                        <td className="py-2 pr-4">
                          {ep.readySlots}/{ep.totalSlots}
                        </td>
                        <td className="py-2 font-medium">
                          {ep.candidatsInscrits}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
