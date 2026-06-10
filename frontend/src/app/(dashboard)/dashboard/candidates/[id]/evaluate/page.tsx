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
  // True tant qu'une édition locale n'a pas été persistée — empêche le
  // polling d'écraser ce que l'examinateur est en train de taper.
  const groupDirty = useRef(false);

  // ── Shared collaboration state (peer evals + group comment feed) ──
  const [peerEvals, setPeerEvals] = useState<any[]>([]);
  const [groupComments, setGroupComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState("");
  const [postingComment, setPostingComment] = useState(false);

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

  // Totaux pour la note collective et les évaluations des pairs
  const totalOf = (scores: Record<number | string, number | string>) =>
    Object.values(scores || {})
      .map(Number)
      .filter((n) => !isNaN(n))
      .reduce((a, b) => a + b, 0);
  const maxTotal = questions.reduce(
    (sum, q) => sum + Number(q.weight || q.maxScore || q.coefficient || 20),
    0,
  );
  const otherEvals = peerEvals.filter((e) => !e.isMine);

  // ── Load group evaluation when épreuve selected ──
  const loadGroupEval = useCallback(async () => {
    if (!selectedEpreuveId || !isGroupEpreuve) return;
    // Ne pas écraser une saisie locale non sauvegardée
    if (groupDirty.current || groupSaveTimer.current) return;
    setGroupLoading(true);
    try {
      const res = await api.get(
        `/evaluations/group?candidateId=${id}&epreuveId=${selectedEpreuveId}`,
      );
      if (groupDirty.current || groupSaveTimer.current) return;
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

  // ── Load peer individual evaluations (other examiners) ──
  const loadPeers = useCallback(async () => {
    if (!selectedEpreuveId || !isGroupEpreuve) return;
    try {
      const res = await api.get(
        `/evaluations/peers?candidateId=${id}&epreuveId=${selectedEpreuveId}`,
      );
      setPeerEvals(res.data?.evaluations || []);
    } catch {
      // Section facultative : on n'affiche pas d'erreur bloquante
    }
  }, [id, selectedEpreuveId, isGroupEpreuve]);

  // ── Load the shared group comment feed ──
  const loadGroupComments = useCallback(async () => {
    if (!selectedEpreuveId || !isGroupEpreuve) return;
    try {
      const res = await api.get(
        `/evaluations/group-comments?candidateId=${id}&epreuveId=${selectedEpreuveId}`,
      );
      setGroupComments(res.data?.comments || []);
    } catch {
      // Silencieux : la table peut ne pas encore exister (migration)
    }
  }, [id, selectedEpreuveId, isGroupEpreuve]);

  useEffect(() => {
    loadGroupEval();
    loadPeers();
    loadGroupComments();
  }, [loadGroupEval, loadPeers, loadGroupComments]);

  // Poll all shared data every 7s so every examiner sees the others' notes,
  // the collective score and the comment feed evolve live.
  useEffect(() => {
    if (!isGroupEpreuve || !selectedEpreuveId) return;
    const t = setInterval(() => {
      loadGroupEval();
      loadPeers();
      loadGroupComments();
    }, 7000);
    return () => clearInterval(t);
  }, [isGroupEpreuve, selectedEpreuveId, loadGroupEval, loadPeers, loadGroupComments]);

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
    groupDirty.current = true;
    if (groupSaveTimer.current) clearTimeout(groupSaveTimer.current);
    groupSaveTimer.current = setTimeout(() => {
      groupSaveTimer.current = null;
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
      // La saisie est persistée : le polling peut de nouveau rafraîchir
      // (sauf si une nouvelle édition a relancé le timer entre-temps).
      if (!groupSaveTimer.current) groupDirty.current = false;
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

  // Ajoute un commentaire au fil partagé du groupe
  const handlePostComment = async () => {
    if (!newComment.trim() || !selectedEpreuveId) return;
    setPostingComment(true);
    try {
      await api.post("/evaluations/group-comments", {
        candidateId: id,
        epreuveId: selectedEpreuveId,
        comment: newComment.trim(),
      });
      setNewComment("");
      await loadGroupComments();
    } catch (e: any) {
      toast(
        e?.response?.data?.error || "Erreur lors de l'ajout du commentaire",
        "error",
      );
    } finally {
      setPostingComment(false);
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
              <div className="text-right">
                <p className="text-lg font-bold text-indigo-700">
                  {totalOf(groupScores)}
                  {maxTotal > 0 && (
                    <span className="text-xs font-medium text-indigo-400">
                      {" "}/ {maxTotal}
                    </span>
                  )}
                </p>
                <p className="text-[10px] text-indigo-500 -mt-0.5">Note collective</p>
                {groupSavedAt && (
                  <p className="text-[11px] text-indigo-600 font-medium mt-1">
                    Dernière maj : {new Date(groupSavedAt).toLocaleTimeString("fr-FR")}
                  </p>
                )}
                {groupLastEditor && (
                  <p className="text-[10px] text-indigo-500">
                    par {groupLastEditor.firstName || groupLastEditor.email}
                  </p>
                )}
              </div>
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
                  <Label>Synthèse collective</Label>
                  <textarea
                    className="w-full p-2 border rounded-md"
                    rows={3}
                    value={groupComment}
                    onChange={(e) => handleGroupComment(e.target.value)}
                    placeholder="Synthèse partagée, modifiable par tous les examinateurs…"
                  />
                </div>

                {/* ── Fil de commentaires du groupe ── */}
                <div className="space-y-2 border-t border-indigo-100 pt-4">
                  <Label>Commentaires du groupe</Label>
                  <p className="text-xs text-gray-500">
                    Visible par tous les examinateurs du créneau — chacun peut
                    en ajouter.
                  </p>
                  {groupComments.length === 0 ? (
                    <p className="text-sm text-gray-400 italic">
                      Aucun commentaire pour l&apos;instant.
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                      {groupComments.map((c: any) => (
                        <div
                          key={c.id}
                          className={`p-2.5 rounded-lg text-sm border ${
                            c.isMine
                              ? "bg-indigo-50 border-indigo-100"
                              : "bg-gray-50 border-gray-100"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-0.5">
                            <span className="text-xs font-semibold text-gray-700">
                              {c.isMine
                                ? "Vous"
                                : `${c.author?.firstName || ""} ${c.author?.lastName || ""}`.trim() ||
                                  c.author?.email ||
                                  "Examinateur"}
                            </span>
                            <span className="text-[10px] text-gray-400">
                              {new Date(c.createdAt).toLocaleTimeString("fr-FR", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                          <p className="text-gray-800 whitespace-pre-wrap">
                            {c.comment}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2 items-end">
                    <textarea
                      className="flex-1 p-2 border rounded-md text-sm"
                      rows={2}
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      placeholder="Ajouter un commentaire sur le groupe…"
                    />
                    <Button
                      type="button"
                      disabled={postingComment || !newComment.trim()}
                      onClick={handlePostComment}
                    >
                      Ajouter
                    </Button>
                  </div>
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
                Visible par les autres examinateurs du créneau et l&apos;admin
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

      {/* ───────── Peer evaluations (other examiners, live) ───────── */}
      {selectedEpreuve && isGroupEpreuve && (
        <Card>
          <CardHeader>
            <CardTitle>Évaluations des autres examinateurs</CardTitle>
            <p className="text-xs text-gray-500 mt-1">
              Notes et commentaires individuels de vos pairs — mise à jour
              automatique toutes les 7 secondes.
            </p>
          </CardHeader>
          <CardContent>
            {otherEvals.length === 0 ? (
              <p className="text-sm text-gray-400 italic">
                Aucune évaluation d&apos;un autre examinateur pour l&apos;instant.
              </p>
            ) : (
              <div className="space-y-3">
                {otherEvals.map((ev: any) => (
                  <div
                    key={ev.id}
                    className="p-3 bg-gray-50 rounded-lg border border-gray-100"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-800">
                        {`${ev.author?.firstName || ""} ${ev.author?.lastName || ""}`.trim() ||
                          ev.author?.email ||
                          "Examinateur"}
                      </p>
                      <p className="text-sm font-bold text-blue-600">
                        {totalOf(ev.scores)}
                        {maxTotal > 0 && (
                          <span className="text-xs font-medium text-gray-400">
                            {" "}/ {maxTotal}
                          </span>
                        )}
                      </p>
                    </div>
                    {ev.comment && (
                      <p className="text-sm text-gray-600 italic mt-1 whitespace-pre-wrap">
                        {ev.comment}
                      </p>
                    )}
                    <p className="text-[10px] text-gray-400 mt-1">
                      Maj :{" "}
                      {new Date(ev.updatedAt).toLocaleTimeString("fr-FR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                ))}
              </div>
            )}
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
