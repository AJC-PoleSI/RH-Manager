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

export default function KPIsPage() {
  const [data, setData] = useState<KPIData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchKPIs = async () => {
      try {
        const res = await api.get("/kpis/global");
        setData(res.data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
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
    </div>
  );
}
