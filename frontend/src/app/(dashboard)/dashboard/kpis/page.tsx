"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Users, ClipboardCheck, Award, UserCheck } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

interface KPIData {
  totalCandidates: number;
  totalEvaluations: number;
  totalEpreuves: number;
  totalMembers: number;
  evaluationsPerMember: { memberId: string; _count: { id: number } }[];
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
  totals: { totalSlots: number; readySlots: number; candidatsInscrits: number };
}

export default function KPIsPage() {
  const [data, setData] = useState<KPIData | null>(null);
  const [slotsData, setSlotsData] = useState<SlotsKPIData | null>(null);
  const [slotsError, setSlotsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

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

  const stats = [
    {
      label: "Candidats",
      value: data.totalCandidates,
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

  const chartData = data.evaluationsPerMember.map((item, index) => ({
    name: `Membre ${index + 1}`,
    evaluations: item._count.id,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Statistiques (KPIs)</h1>
        <p className="text-gray-500">
          Vue d&apos;ensemble des performances du recrutement.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-6">
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

      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Évaluations par membre</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar
                    dataKey="evaluations"
                    fill="#6366f1"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {slotsData && (
        <Card>
          <CardHeader>
            <CardTitle>Créneaux &amp; inscriptions par épreuve</CardTitle>
            <p className="text-sm text-gray-500">
              {slotsData.totals.readySlots} créneaux prêts sur{" "}
              {slotsData.totals.totalSlots} · {slotsData.totals.candidatsInscrits}{" "}
              candidats inscrits au total.
            </p>
          </CardHeader>
          <CardContent>
            {slotsData.epreuves.length === 0 ? (
              <p className="text-sm text-gray-500">
                Aucun créneau rattaché à une épreuve pour le moment.
              </p>
            ) : (
              <div className="overflow-x-auto">
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
                    {slotsData.epreuves.map((ep) => (
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
