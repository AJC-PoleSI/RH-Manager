"use client";

import { useEffect, useState, useCallback, Suspense, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import api from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

interface Question {
  q?: string;
  question?: string;
  weight?: number | string;
  maxScore?: number | string;
  coefficient?: number | string;
}

function ScoreGrid({
  questions,
  scores,
  scoreErrors,
  onChange,
  disabled,
}: {
  questions: Question[];
  scores: Record<number, string>;
  scoreErrors: Record<number, string>;
  onChange: (idx: number, val: string, maxPoints: number) => void;
  disabled?: boolean;
}) {
  if (questions.length === 0) {
    return (
      <p className="text-sm text-gray-500 italic">
        Aucun critère défini pour cette épreuve.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {questions.map((q, idx) => {
        const maxPoints = Number(q.weight || q.maxScore || q.coefficient || 20);
        return (
          <div key={idx} className="space-y-1">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-4 items-center">
              <Label>{q.q || q.question}</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="0"
                  max={maxPoints}
                  placeholder="0"
                  required
                  disabled={disabled}
                  value={scores[idx] ?? ""}
                  className={scoreErrors[idx] ? "border-red-500" : ""}
                  onChange={(e) => onChange(idx, e.target.value, maxPoints)}
                />
                <span className="text-sm text-gray-500 whitespace-nowrap font-medium">
                  / {maxPoints}
                </span>
              </div>
            </div>
            {scoreErrors[idx] && (
              <p className="text-red-500 text-xs sm:text-right">
                {scoreErrors[idx]}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EvaluateCandidateForm({ id }: { id: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialEpreuveId = searchParams?.get("epreuveId") || "";
  const { toast } = useToast();

  const [candidate, setCandidate] = useState<any>(null);
  const [epreuves, setEpreuves] = useState<any[]>([]);
  const [selectedEpreuveId, setSelectedEpreuveId] = useState<string>(initialEpreuveId);
  const [loading, setLoading] = useState(true);

  // ── Individual evaluation state ──
  const [indivScores, setIndivScores] = useState<Record<number, string>>({});
  const [indivComment, setIndivComment] = useState("");
  const [indivErrors, setIndivErrors] = useState<Record<number, string>>({});

  // ── Group evaluation state ──
  const [groupEvalId, setGroupEvalId] = useState<string | null>(null);
  const [groupScores, setGroupScores] = useState<Record<number, string>>({});
  const [groupComment, setGroupComment] = useState("");
  const [groupErrors, setGroupErrors] = useState<Record<number, string>>({});
  const [groupLoading, setGroupLoading] = useState(false);
  const [groupSavedAt, setGroupSavedAt] = useState<string | null>(null);
  const [groupLastEditor, setGroupLastEditor] = useState<any>(null);
  const groupSaveTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [candRes, epRes] = await Promise.all([
          api.get(`/candidates/${id}`),
          api.get("/epreuves"),
        ]);
        setCandidate(candRes.data);
        setEpreuves(epRes.data);
      } catch (error) {
        console.error(error);
        toast("Erreur lors du chargement des données", "error");
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [id, toast]);

  const selectedEpreuve = epreuves.find((e) => e.id === selectedEpreuveId);
  const isGroupEpreuve = !!selectedEpreuve?.isGroupEpreuve;

  let questions: Question[] = [];
  try {
    if (selectedEpreuve?.evaluationQuestions) {
      questions =
        typeof selectedEpreuve.evaluationQuestions === "string"
          ? JSON.parse(selectedEpreuve.evaluationQuestions)
          : selectedEpreuve.evaluationQuestions;
    }
  } catch {
    questions = [];
  }

  // ── Load group evaluation when épreuve selected ──
  const loadGroupEval = useCallback(async () => {
    if (!selectedEpreuveId || !isGroupEpreuve) return;
    setGroupLoading(true);
    try {
      const res = await api.get(
        `/evaluations/group?candidateId=${id}&epreuveId=${selectedEpreuveId}`,
      );
      if (res.data?.exists) {
        setGroupEvalId(res.data.id);
        const sc: Record<number, string> = {};
        Object.entries(res.data.scores || {}).forEach(([k, v]) => {
          sc[Number(k)] = String(v);
        });
        setGroupScores(sc);
        setGroupComment(res.data.comment || "");
        setGroupSavedAt(res.data.updatedAt);
        setGroupLastEditor(res.data.lastEditor);
      } else {
        setGroupEvalId(null);
        setGroupScores({});
        setGroupComment("");
        setGroupSavedAt(null);
        setGroupLastEditor(null);
      }
    } catch (e) {
      console.error("Failed to load group eval:", e);
    } finally {
      setGroupLoading(false);
    }
  }, [id, selectedEpreuveId, isGroupEpreuve]);

  useEffect(() => {
    loadGroupEval();
  }, [loadGroupEval]);

  // Poll the group eval every 10s so collaborators see fresh data
  useEffect(() => {
    if (!isGroupEpreuve || !selectedEpreuveId) return;
    const t = setInterval(loadGroupEval, 10000);
    return () => clearInterval(t);
  }, [isGroupEpreuve, selectedEpreuveId, loadGroupEval]);

  const validateScore = (
    idx: number,
    val: string,
    maxPoints: number,
    setErrors: (fn: (prev: Record<number, string>) => Record<number, string>) => void,
  ) => {
    const numVal = Number(val);
    if (val !== "" && numVal > maxPoints) {
      setErrors((prev) => ({ ...prev, [idx]: `Max ${maxPoints}` }));
    } else if (val !== "" && numVal < 0) {
      setErrors((prev) => ({ ...prev, [idx]: `Min 0` }));
    } else {
      setErrors((prev) => {
        const copy = { ...prev };
        delete copy[idx];
        return copy;
      });
    }
  };

  const handleIndivScore = (idx: number, val: string, maxPoints: number) => {
    setIndivScores((p) => ({ ...p, [idx]: val }));
    validateScore(idx, val, maxPoints, setIndivErrors);
  };

  const handleGroupScore = (idx: number, val: string, maxPoints: number) => {
    setGroupScores((p) => ({ ...p, [idx]: val }));
    validateScore(idx, val, maxPoints, setGroupErrors);
    scheduleGroupSave({ ...groupScores, [idx]: val }, groupComment);
  };

  const handleGroupComment = (val: string) => {
    setGroupComment(val);
    scheduleGroupSave(groupScores, val);
  };

  // Debounced auto-save for group eval (so collaborators see edits within 1s)
  const scheduleGroupSave = (scores: Record<number, string>, comment: string) => {
    if (groupSaveTimer.current) clearTimeout(groupSaveTimer.current);
    groupSaveTimer.current = setTimeout(() => {
      saveGroupEval(scores, comment);
    }, 1000);
  };

  const saveGroupEval = async (
    scores: Record<number, string>,
    comment: string,
  ) => {
    try {
      if (groupEvalId) {
        await api.put(`/evaluations/${groupEvalId}`, { scores, comment });
      } else {
        const res = await api.post("/evaluations", {
          candidateId: id,
          epreuveId: selectedEpreuveId,
          scores,
          comment,
          isGroup: true,
        });
        setGroupEvalId(res.data.id);
      }
      setGroupSavedAt(new Date().toISOString());
    } catch (e: any) {
      // If 409 (already exists), reload to grab the existing id
      if (e?.response?.status === 409 && e.response.data?.id) {
        setGroupEvalId(e.response.data.id);
        await loadGroupEval();
      } else {
        console.error("Group save failed:", e);
        toast(
          e?.response?.data?.error ||
            "Erreur d'enregistrement de l'évaluation collective",
          "error",
        );
      }
    }
  };

  const handleIndivSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (Object.keys(indivErrors).length > 0) {
      toast("Corrigez les notes avant de soumettre", "error");
      return;
    }
    try {
      // For group épreuves, ensure group eval exists/saved before submitting individual
      if (isGroupEpreuve && !groupEvalId) {
        await saveGroupEval(groupScores, groupComment);
      }
      await api.post("/evaluations", {
        candidateId: id,
        epreuveId: selectedEpreuveId,
        scores: indivScores,
        comment: indivComment,
        isGroup: false,
      });
      toast("Évaluation individuelle enregistrée !", "success");
      router.push("/dashboard/candidates");
    } catch (error: any) {
      console.error(error);
      const serverMsg = error?.response?.data?.error;
      toast(serverMsg || "Erreur lors de l'enregistrement", "error");
    }
  };

  if (loading) return <div className="p-8">Chargement...</div>;
  if (!candidate) return <div className="p-8">Candidat introuvable</div>;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center text-2xl font-bold text-primary-700">
          {candidate.firstName?.[0]}
          {candidate.lastName?.[0]}
        </div>
        <div>
          <h1 className="text-2xl font-semibold">
            {candidate.firstName} {candidate.lastName}
          </h1>
          <p className="text-gray-500">{candidate.email}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Choisir l&apos;épreuve</CardTitle>
        </CardHeader>
        <CardContent>
          <select
            className="w-full p-2 border rounded-md"
            value={selectedEpreuveId}
            onChange={(e) => setSelectedEpreuveId(e.target.value)}
            required
          >
            <option value="">-- Sélectionner une épreuve --</option>
            {epreuves.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.type}){e.isGroupEpreuve ? " · groupe" : ""}
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      {/* ───────── Group evaluation section (only for group épreuves) ───────── */}
      {selectedEpreuve && isGroupEpreuve && (
        <Card className="border-indigo-200">
          <CardHeader className="bg-indigo-50/50">
            <div className="flex items-start justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-indigo-900">
                  👥 Évaluation collective
                </CardTitle>
                <p className="text-xs text-indigo-700 mt-1">
                  Partagée entre tous les examinateurs du créneau · sauvegarde
                  automatique
                </p>
              </div>
              {groupSavedAt && (
                <div className="text-right">
                  <p className="text-[11px] text-indigo-600 font-medium">
                    Dernière maj : {new Date(groupSavedAt).toLocaleTimeString("fr-FR")}
                  </p>
                  {groupLastEditor && (
                    <p className="text-[10px] text-indigo-500">
                      par {groupLastEditor.firstName || groupLastEditor.email}
                    </p>
                  )}
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            {groupLoading && !groupEvalId ? (
              <p className="text-sm text-gray-400">Chargement…</p>
            ) : (
              <>
                <ScoreGrid
                  questions={questions}
                  scores={groupScores}
                  scoreErrors={groupErrors}
                  onChange={handleGroupScore}
                />
                <div className="space-y-2 border-t border-indigo-100 pt-4">
                  <Label>Commentaire collectif</Label>
                  <textarea
                    className="w-full p-2 border rounded-md"
                    rows={4}
                    value={groupComment}
                    onChange={(e) => handleGroupComment(e.target.value)}
                    placeholder="Observations partagées entre examinateurs…"
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ───────── Individual evaluation section ───────── */}
      {selectedEpreuve && (
        <Card>
          <CardHeader>
            <CardTitle>
              {isGroupEpreuve ? "Mon évaluation individuelle" : "Nouvelle Évaluation"}
            </CardTitle>
            {isGroupEpreuve && (
              <p className="text-xs text-gray-500 mt-1">
                Visible uniquement par vous et l&apos;admin
              </p>
            )}
          </CardHeader>
          <CardContent>
            <form onSubmit={handleIndivSubmit} className="space-y-6">
              <ScoreGrid
                questions={questions}
                scores={indivScores}
                scoreErrors={indivErrors}
                onChange={handleIndivScore}
              />
              <div className="space-y-2 border-t border-gray-100 pt-4">
                <Label>Commentaire global</Label>
                <textarea
                  className="w-full p-2 border rounded-md"
                  rows={4}
                  value={indivComment}
                  onChange={(e) => setIndivComment(e.target.value)}
                  placeholder="Notez vos observations…"
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={Object.keys(indivErrors).length > 0}
              >
                Enregistrer mon évaluation
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function EvaluateCandidatePage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <Suspense fallback={<div className="p-8">Chargement...</div>}>
      <EvaluateCandidateForm id={params.id} />
    </Suspense>
  );
}
