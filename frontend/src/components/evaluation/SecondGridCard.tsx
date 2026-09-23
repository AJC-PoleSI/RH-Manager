"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import {
  formatScore,
  parseScoreInput,
  type EvaluationCriterion,
} from "@/lib/evaluation-criteria";
import { POLL, startPolling } from "@/lib/poll";
import { mergeScores, ScoreGrid } from "@/components/evaluation/ScoreGrid";

/**
 * DEUXIÈME GRILLE d'une épreuve (ex. proposition commerciale envoyée après le
 * rendez-vous client). Indépendante de la note de l'entretien : elle reste
 * modifiable par tous les examinateurs du créneau, même quand l'entretien est
 * noté et clos. Sauvegarde automatique. Ne s'affiche que si l'épreuve a une
 * deuxième grille (cf. lib/second-grid.ts).
 */
export default function SecondGridCard({
  candidateId,
  epreuveId,
}: {
  candidateId: string;
  epreuveId: string;
}) {
  const { toast } = useToast();
  const [available, setAvailable] = useState(false);
  const [title, setTitle] = useState("");
  const [questions, setQuestions] = useState<EvaluationCriterion[]>([]);
  const [maxTotal, setMaxTotal] = useState(0);
  const [scores, setScores] = useState<Record<number, string>>({});
  const [comment, setComment] = useState("");
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [lastEditor, setLastEditor] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<NodeJS.Timeout | null>(null);
  // Édition locale pas encore persistée : le rafraîchissement ne l'écrase pas.
  const dirty = useRef(false);

  const load = useCallback(
    async (reset = false) => {
      if (!reset && (dirty.current || saveTimer.current)) return;
      try {
        const res = await api.get(
          `/evaluations/second-grid?candidateId=${candidateId}&epreuveId=${epreuveId}`,
        );
        if (!reset && (dirty.current || saveTimer.current)) return;
        const d = res.data || {};
        setAvailable(!!d.available);
        if (!d.available) return;
        setTitle(d.title || "Deuxième grille");
        setQuestions(d.questions || []);
        setMaxTotal(Number(d.maxTotal) || 0);
        setScores((prev) => mergeScores(reset ? {} : prev, d.scores || {}));
        setComment(d.comment || "");
        setSavedAt(d.exists ? d.updatedAt : null);
        setLastEditor(d.lastEditor || null);
      } catch {
        // 403 (pas examinateur de ce créneau) ou panne : on masque le panneau.
        setAvailable(false);
      }
    },
    [candidateId, epreuveId],
  );

  useEffect(() => {
    dirty.current = false;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    setErrors({});
    load(true);
  }, [load]);

  // Le binôme voit la saisie de l'autre examinateur arriver.
  useEffect(() => {
    if (!available) return;
    return startPolling(() => load(), POLL.chat);
  }, [available, load]);

  const save = async (s: Record<number, string>, c: string) => {
    setSaving(true);
    try {
      const res = await api.post("/evaluations/second-grid", {
        candidateId,
        epreuveId,
        scores: s,
        comment: c,
      });
      setSavedAt(res.data?.updatedAt || new Date().toISOString());
      setLastEditor(res.data?.lastEditor || null);
      if (!saveTimer.current) dirty.current = false;
    } catch (e: any) {
      toast(
        e?.response?.data?.error ||
          `Erreur d'enregistrement de la grille « ${title} »`,
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  const scheduleSave = (s: Record<number, string>, c: string) => {
    dirty.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      save(s, c);
    }, 1000);
  };

  // Une note hors barème reste en rouge à l'écran et n'est jamais envoyée.
  const errorFor = (val: string, maxPoints: number): string | null => {
    if (val === "") return null;
    const n = parseScoreInput(val);
    if (n === null) return "Nombre attendu";
    if (n > maxPoints) return `Max ${maxPoints}`;
    if (n < 0) return "Min 0";
    return null;
  };
  const valid = (s: Record<number, string>, errs: Record<number, string>) =>
    Object.fromEntries(
      Object.entries(s).filter(([k]) => !errs[Number(k)]),
    ) as Record<number, string>;

  const handleScore = (idx: number, val: string, maxPoints: number) => {
    const nextScores = { ...scores, [idx]: val };
    const nextErrors = { ...errors };
    const err = errorFor(val, maxPoints);
    if (err) nextErrors[idx] = err;
    else delete nextErrors[idx];
    setScores(nextScores);
    setErrors(nextErrors);
    scheduleSave(valid(nextScores, nextErrors), comment);
  };

  const handleComment = (val: string) => {
    setComment(val);
    scheduleSave(valid(scores, errors), val);
  };

  if (!available) return null;

  const total = formatScore(
    Object.values(scores)
      .map(parseScoreInput)
      .filter((n): n is number => n !== null)
      .reduce((a, b) => a + b, 0),
  );
  const editorName = lastEditor
    ? `${lastEditor.firstName || ""} ${lastEditor.lastName || ""}`.trim() ||
      lastEditor.email
    : null;

  return (
    <Card className="border-amber-200">
      <CardHeader className="bg-amber-50/50">
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-amber-900">
              📄 {title}
            </CardTitle>
            <p className="text-xs text-amber-800 mt-1">
              Deuxième grille de cette épreuve, à remplir quand vous avez le
              document. Vous pouvez y revenir à tout moment, même si
              l&apos;entretien est déjà noté. L&apos;un ou l&apos;autre des
              examinateurs peut la remplir.
            </p>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-amber-700">
              {total}
              <span className="text-xs font-medium text-amber-400">
                {" "}/ {maxTotal}
              </span>
            </p>
            {saving ? (
              <p className="text-[11px] text-amber-600 mt-1">Enregistrement…</p>
            ) : savedAt ? (
              <p className="text-[11px] text-amber-600 font-medium mt-1">
                Enregistrée à{" "}
                {new Date(savedAt).toLocaleTimeString("fr-FR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {editorName ? ` par ${editorName}` : ""}
              </p>
            ) : (
              <p className="text-[11px] text-amber-500 mt-1">Pas encore notée</p>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        <ScoreGrid
          questions={questions}
          scores={scores}
          scoreErrors={errors}
          onChange={handleScore}
        />
        <div className="space-y-2 border-t border-amber-100 pt-4">
          <Label>Commentaire</Label>
          <textarea
            className="w-full p-2 border rounded-md"
            rows={3}
            value={comment}
            onChange={(e) => handleComment(e.target.value)}
            placeholder="Points forts, points faibles du document…"
          />
          <p className="text-[11px] text-gray-400">Sauvegarde automatique.</p>
        </div>
      </CardContent>
    </Card>
  );
}
