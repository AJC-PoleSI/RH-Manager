"use client";

import { useEffect, useState, useCallback, Suspense, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import api from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  formatScore,
  getCriterionHint,
  getCriterionLabel,
  getMaxPoints,
  isScoreInput,
  parseScoreInput,
  type EvaluationCriterion,
} from "@/lib/evaluation-criteria";
import { POLL, startPolling } from "@/lib/poll";
import {
  GROUP_EVALUATION_MAX,
  GROUP_EVALUATION_QUESTIONS,
} from "@/lib/group-evaluation-criteria";

type Question = EvaluationCriterion;

/**
 * Fusionne les notes renvoyées par le serveur avec la saisie déjà à l'écran.
 * Une case dont le texte local vaut DÉJÀ la même note est laissée intacte :
 * sans ça, « 3, » (décimale pas encore tapée, enregistrée comme 3) revenait
 * en « 3 » au rafraîchissement suivant et la frappe du « 5 » donnait « 35 ».
 */
function mergeScores(
  local: Record<number, string>,
  incoming: Record<string, unknown>,
): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [key, value] of Object.entries(incoming || {})) {
    const idx = Number(key);
    const localVal = local[idx];
    out[idx] =
      localVal !== undefined &&
      parseScoreInput(localVal) === parseScoreInput(value)
        ? localVal
        : formatScore(value);
  }
  return out;
}

/** Libellé d'un critère, suivi d'un « i » qui déplie sa précision s'il en a une. */
function CriterionLabel({ question }: { question: Question }) {
  const [open, setOpen] = useState(false);
  const hint = getCriterionHint(question);
  return (
    <div>
      <div className="flex items-start gap-1.5">
        <Label>{getCriterionLabel(question)}</Label>
        {hint && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            title={hint}
            aria-label="Précision sur ce critère"
            aria-expanded={open}
            className={`shrink-0 w-4 h-4 mt-0.5 rounded-full border text-[10px] font-semibold italic leading-none flex items-center justify-center ${
              open
                ? "bg-blue-600 border-blue-600 text-white"
                : "border-gray-400 text-gray-500 hover:border-blue-500 hover:text-blue-600"
            }`}
          >
            i
          </button>
        )}
      </div>
      {hint && open && (
        <p className="mt-1 text-xs text-gray-600 bg-blue-50 border border-blue-100 rounded px-2 py-1.5">
          {hint}
        </p>
      )}
    </div>
  );
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
      <p className="text-xs text-gray-400">
        Les demi-points sont acceptés (ex. 3,5).
      </p>
      {questions.map((q, idx) => {
        const maxPoints = getMaxPoints(q);
        return (
          <div key={idx} className="space-y-1">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-4 items-center">
              <CriterionLabel question={q} />
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  disabled={disabled}
                  value={scores[idx] ?? ""}
                  className={scoreErrors[idx] ? "border-red-500" : ""}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\s/g, "");
                    if (!isScoreInput(val)) return;
                    onChange(idx, val, maxPoints);
                  }}
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
  const [isAdmin, setIsAdmin] = useState(false);

  // ── Individual evaluation state ──
  const [indivScores, setIndivScores] = useState<Record<number, string>>({});
  const [indivComment, setIndivComment] = useState("");
  const [indivErrors, setIndivErrors] = useState<Record<number, string>>({});

  // ── Group evaluation state (aussi utilisé pour la note partagée en
  // binôme sur une épreuve individuelle — cf. isBinome plus bas) ──
  const [groupEvalId, setGroupEvalId] = useState<string | null>(null);
  const [groupScores, setGroupScores] = useState<Record<number, string>>({});
  const [groupComment, setGroupComment] = useState("");
  const [groupErrors, setGroupErrors] = useState<Record<number, string>>({});
  const [groupLoading, setGroupLoading] = useState(false);
  const [groupSavedAt, setGroupSavedAt] = useState<string | null>(null);
  const [groupLastEditor, setGroupLastEditor] = useState<any>(null);
  const [groupCanEdit, setGroupCanEdit] = useState(true);
  const [groupClosedAt, setGroupClosedAt] = useState<string | null>(null);
  const [groupClosedBy, setGroupClosedBy] = useState<any>(null);
  const [closingEval, setClosingEval] = useState(false);
  const [reopeningEval, setReopeningEval] = useState(false);
  const groupSaveTimer = useRef<NodeJS.Timeout | null>(null);
  // True tant qu'une édition locale n'a pas été persistée — empêche le
  // polling d'écraser ce que l'examinateur est en train de taper.
  const groupDirty = useRef(false);

  // ── Évaluation DU GROUPE (épreuve de groupe / business game) ──
  // Une seule grille par créneau, 9 critères propres au travail collectif.
  // Le premier examinateur qui saisit prend la main ; les autres consultent.
  // Cette note n'entre PAS dans la moyenne des candidats.
  const [noteId, setNoteId] = useState<string | null>(null);
  const [noteScores, setNoteScores] = useState<Record<number, string>>({});
  const [noteComment, setNoteComment] = useState("");
  const [noteErrors, setNoteErrors] = useState<Record<number, string>>({});
  const [noteOwner, setNoteOwner] = useState<any>(null);
  const [noteIsMine, setNoteIsMine] = useState(false);
  const [noteCanEdit, setNoteCanEdit] = useState(true);
  const [noteSavedAt, setNoteSavedAt] = useState<string | null>(null);
  const [noteLoading, setNoteLoading] = useState(false);
  /** Message bloquant (migration en attente, candidat sans créneau…). */
  const [noteUnavailable, setNoteUnavailable] = useState<string | null>(null);
  const noteSaveTimer = useRef<NodeJS.Timeout | null>(null);
  const noteDirty = useRef(false);

  // ── Shared collaboration state (peer evals + group comment feed) ──
  const [peerEvals, setPeerEvals] = useState<any[]>([]);
  const [groupComments, setGroupComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState("");
  const [postingComment, setPostingComment] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        // On ne charge QUE les épreuves que l'examinateur a le droit
        // d'évaluer pour ce candidat (créneau commun). Les admins
        // reçoivent la liste complète depuis la même route.
        const [candRes, epRes] = await Promise.all([
          api.get(`/candidates/${id}`),
          api.get(`/evaluations/allowed-epreuves?candidateId=${id}`),
        ]);
        setCandidate(candRes.data);
        setEpreuves(epRes.data?.epreuves || []);
        setIsAdmin(!!epRes.data?.isAdmin);
      } catch (error) {
        console.error(error);
        toast("Erreur lors du chargement des données", "error");
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [id, toast]);

  // Une épreuve passée en query string mais absente de la liste autorisée
  // ne doit pas rester sélectionnée (lien reçu, favori, retour arrière…).
  useEffect(() => {
    if (loading || !selectedEpreuveId) return;
    if (!epreuves.some((e) => e.id === selectedEpreuveId)) {
      setSelectedEpreuveId("");
    }
  }, [loading, epreuves, selectedEpreuveId]);

  const selectedEpreuve = epreuves.find((e) => e.id === selectedEpreuveId);
  const isGroupEpreuve = !!selectedEpreuve?.isGroupEpreuve;
  // Épreuve individuelle (pas "de groupe") dont le créneau du candidat a 2
  // examinateurs assignés ou plus : un seul note, la note est partagée et
  // attribuée aux deux. Le serveur retranche déjà `examinerCount` sur
  // resolveCandidateSlot + slot_member_assignments.
  const isBinome = !isGroupEpreuve && (selectedEpreuve?.examinerCount ?? 0) >= 2;
  // Notation individuelle déjà close pour ce candidat sur cette épreuve :
  // ma propre note, la note du binôme, ou — sur un business game — celle de
  // l'examinateur qui a observé ce candidat (cf. lib/evaluation-closure).
  const closureReason: string | null = selectedEpreuve?.closure?.closed
    ? selectedEpreuve.closure.reason
    : null;
  const indivClosed = closureReason !== null;
  const closureAuthor =
    `${selectedEpreuve?.closure?.by?.firstName || ""} ${selectedEpreuve?.closure?.by?.lastName || ""}`.trim() ||
    selectedEpreuve?.closure?.by?.email ||
    "un autre examinateur";
  // La note partagée ne subsiste QUE pour le binôme sur un entretien. Sur une
  // épreuve de groupe, elle est remplacée par la grille « Évaluation du
  // groupe » ci-dessous (une par créneau, un seul rédacteur).
  const showSharedPanel = isBinome;
  // Fil de commentaires : utile dans les deux cas (groupe et binôme).
  const showComments = isGroupEpreuve || isBinome;

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
  // parseScoreInput (et non Number) : une note saisie « 3,5 » doit peser 3.5
  // dans le total, pas disparaître.
  const totalOf = (scores: Record<number | string, number | string>) =>
    formatScore(
      Object.values(scores || {})
        .map(parseScoreInput)
        .filter((n): n is number => n !== null)
        .reduce((a, b) => a + b, 0),
    );
  const maxTotal = questions.reduce((sum, q) => sum + getMaxPoints(q), 0);
  const otherEvals = peerEvals.filter((e) => !e.isMine);

  // ── Load group/binôme evaluation when épreuve selected ──
  const loadGroupEval = useCallback(async () => {
    if (!selectedEpreuveId || !showSharedPanel) return;
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
        setGroupScores((prev) => mergeScores(prev, res.data.scores || {}));
        setGroupComment(res.data.comment || "");
        setGroupSavedAt(res.data.updatedAt);
        setGroupLastEditor(res.data.lastEditor);
        // canEdit absent (migration pas encore appliquée) => comportement
        // d'avant, tout le monde peut éditer.
        setGroupCanEdit(res.data.canEdit ?? true);
        setGroupClosedAt(res.data.closedAt ?? null);
        setGroupClosedBy(res.data.closedBy ?? null);
      } else {
        setGroupEvalId(null);
        setGroupScores({});
        setGroupComment("");
        setGroupSavedAt(null);
        setGroupLastEditor(null);
        setGroupCanEdit(true);
        setGroupClosedAt(null);
        setGroupClosedBy(null);
      }
    } catch (e) {
      console.error("Failed to load group eval:", e);
    } finally {
      setGroupLoading(false);
    }
  }, [id, selectedEpreuveId, showSharedPanel]);

  // ── Load peer individual evaluations (other examiners) — uniquement les
  // vraies épreuves de groupe : en binôme il n'y a qu'une seule note. ──
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
    if (!selectedEpreuveId || !showComments) return;
    try {
      const res = await api.get(
        `/evaluations/group-comments?candidateId=${id}&epreuveId=${selectedEpreuveId}`,
      );
      setGroupComments(res.data?.comments || []);
    } catch {
      // Silencieux : la table peut ne pas encore exister (migration)
    }
  }, [id, selectedEpreuveId, showComments]);

  // ── Load the group grid (épreuve de groupe) ──
  const loadGroupNote = useCallback(async () => {
    if (!selectedEpreuveId || !isGroupEpreuve) return;
    // Ne pas écraser une saisie locale non sauvegardée
    if (noteDirty.current || noteSaveTimer.current) return;
    setNoteLoading(true);
    try {
      const res = await api.get(
        `/evaluations/group-note?candidateId=${id}&epreuveId=${selectedEpreuveId}`,
      );
      if (noteDirty.current || noteSaveTimer.current) return;
      setNoteUnavailable(null);
      if (res.data?.exists) {
        setNoteId(res.data.id);
        setNoteScores((prev) => mergeScores(prev, res.data.scores || {}));
        setNoteComment(res.data.comment || "");
        setNoteSavedAt(res.data.updatedAt);
        setNoteOwner(res.data.owner || null);
        setNoteIsMine(!!res.data.isMine);
        setNoteCanEdit(res.data.canEdit !== false);
      } else {
        setNoteId(null);
        setNoteScores({});
        setNoteComment("");
        setNoteSavedAt(null);
        setNoteOwner(null);
        setNoteIsMine(false);
        setNoteCanEdit(true);
      }
    } catch (e: any) {
      // Migration en attente, candidat sans créneau… : on explique plutôt
      // que d'afficher une grille qui ne pourra jamais être enregistrée.
      setNoteUnavailable(
        e?.response?.data?.error ||
          "Évaluation du groupe indisponible pour ce créneau.",
      );
    } finally {
      setNoteLoading(false);
    }
  }, [id, selectedEpreuveId, isGroupEpreuve]);

  useEffect(() => {
    loadGroupEval();
    loadGroupNote();
    loadPeers();
    loadGroupComments();
  }, [loadGroupEval, loadGroupNote, loadPeers, loadGroupComments]);

  // Poll all shared data every 20s (visible tab only) so every examiner sees
  // the others' notes, the group grid and the comment feed evolve. Each tick
  // is 5-6 Supabase reads: at 7s this page alone produced ~15 000 reads/day.
  useEffect(() => {
    if ((!showSharedPanel && !showComments) || !selectedEpreuveId) return;
    // Quatre requêtes par passage : on garde le panneau vivant sans le
    // rejouer toutes les 7 s, et jamais quand l'onglet est caché.
    return startPolling(() => {
      loadGroupEval();
      loadGroupNote();
      loadPeers();
      loadGroupComments();
    }, POLL.chat);
  }, [
    showSharedPanel,
    showComments,
    selectedEpreuveId,
    loadGroupEval,
    loadGroupNote,
    loadPeers,
    loadGroupComments,
  ]);

  const validateScore = (
    idx: number,
    val: string,
    maxPoints: number,
    setErrors: (fn: (prev: Record<number, string>) => Record<number, string>) => void,
  ) => {
    const numVal = parseScoreInput(val);
    if (val !== "" && numVal === null) {
      setErrors((prev) => ({ ...prev, [idx]: `Nombre attendu` }));
    } else if (val !== "" && numVal !== null && numVal > maxPoints) {
      setErrors((prev) => ({ ...prev, [idx]: `Max ${maxPoints}` }));
    } else if (val !== "" && numVal !== null && numVal < 0) {
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

  // Une valeur hors barème n'est JAMAIS envoyée au serveur (qui la refuserait
  // en 400) : elle reste en rouge à l'écran jusqu'à correction, et les autres
  // critères continuent d'être sauvegardés normalement.
  const isInvalidScore = (val: string, maxPoints: number) => {
    if (val === "") return false;
    const n = parseScoreInput(val);
    return n === null || n < 0 || n > maxPoints;
  };
  const withoutInvalid = (
    scores: Record<number, string>,
    errors: Record<number, string>,
  ) =>
    Object.fromEntries(
      Object.entries(scores).filter(([k]) => !errors[Number(k)]),
    ) as Record<number, string>;

  const handleGroupScore = (idx: number, val: string, maxPoints: number) => {
    if (!groupCanEdit || groupClosedAt) return;
    setGroupScores((p) => ({ ...p, [idx]: val }));
    validateScore(idx, val, maxPoints, setGroupErrors);
    const nextErrors = { ...groupErrors };
    if (isInvalidScore(val, maxPoints)) nextErrors[idx] = "invalid";
    else delete nextErrors[idx];
    scheduleGroupSave(
      withoutInvalid({ ...groupScores, [idx]: val }, nextErrors),
      groupComment,
    );
  };

  const handleGroupComment = (val: string) => {
    if (!groupCanEdit || groupClosedAt) return;
    setGroupComment(val);
    scheduleGroupSave(withoutInvalid(groupScores, groupErrors), val);
  };

  // Lève le drapeau « saisie locale non sauvegardée » et annule la
  // sauvegarde différée : à appeler avant tout rechargement forcé, sinon
  // loadGroupEval refuse d'écraser l'écran et le polling reste bloqué.
  const resetGroupDirty = () => {
    groupDirty.current = false;
    if (groupSaveTimer.current) {
      clearTimeout(groupSaveTimer.current);
      groupSaveTimer.current = null;
    }
  };

  // Valide/clôture la note partagée (binôme ou collective) : plus personne
  // à part un admin ne peut la modifier après ça.
  const handleValidateClose = async () => {
    if (!groupEvalId) return;
    setClosingEval(true);
    try {
      const res = await api.post(`/evaluations/${groupEvalId}/close`);
      setGroupClosedAt(res.data?.closedAt || new Date().toISOString());
      toast("Évaluation clôturée.", "success");
      await loadGroupEval();
    } catch (e: any) {
      toast(
        e?.response?.data?.error || "Erreur lors de la clôture",
        "error",
      );
    } finally {
      setClosingEval(false);
    }
  };

  // Réouverture (admin uniquement) d'une évaluation clôturée.
  const handleReopen = async () => {
    if (!groupEvalId) return;
    setReopeningEval(true);
    try {
      await api.post(`/evaluations/${groupEvalId}/reopen`);
      toast("Évaluation rouverte.", "success");
      await loadGroupEval();
    } catch (e: any) {
      toast(
        e?.response?.data?.error || "Erreur lors de la réouverture",
        "error",
      );
    } finally {
      setReopeningEval(false);
    }
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
      const status = e?.response?.status;
      if (status === 409 && e.response.data?.id) {
        // Un co-examinateur a créé la note au même instant : on reprend la
        // sienne. Le drapeau « saisie locale » doit être levé AVANT le
        // rechargement, sinon loadGroupEval refuse d'écraser l'écran et le
        // polling ne rafraîchit plus jamais cette page.
        resetGroupDirty();
        setGroupEvalId(e.response.data.id);
        await loadGroupEval();
        toast(
          "Votre binôme a déjà commencé cette note : sa saisie est affichée.",
          "info",
        );
      } else if (status === 403) {
        // Clôturée entre-temps, ou note d'un binôme dont on n'est pas
        // l'auteur : on repasse en lecture seule sur l'état réel.
        resetGroupDirty();
        await loadGroupEval();
        toast(
          e?.response?.data?.error ||
            "Vous ne pouvez plus modifier cette évaluation.",
          "error",
        );
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

  // ── Évaluation du groupe : saisie + sauvegarde différée ──────────────
  const resetNoteDirty = () => {
    noteDirty.current = false;
    if (noteSaveTimer.current) {
      clearTimeout(noteSaveTimer.current);
      noteSaveTimer.current = null;
    }
  };

  const scheduleNoteSave = (
    scores: Record<number, string>,
    comment: string,
  ) => {
    noteDirty.current = true;
    if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
    noteSaveTimer.current = setTimeout(() => {
      noteSaveTimer.current = null;
      saveGroupNote(scores, comment);
    }, 1000);
  };

  const saveGroupNote = async (
    scores: Record<number, string>,
    comment: string,
  ) => {
    try {
      const res = await api.post("/evaluations/group-note", {
        candidateId: id,
        epreuveId: selectedEpreuveId,
        scores,
        comment,
      });
      setNoteId(res.data?.id ?? null);
      setNoteOwner(res.data?.owner ?? null);
      setNoteIsMine(res.data?.isMine !== false);
      setNoteCanEdit(res.data?.canEdit !== false);
      setNoteSavedAt(res.data?.updatedAt || new Date().toISOString());
      if (!noteSaveTimer.current) noteDirty.current = false;
    } catch (e: any) {
      const status = e?.response?.status;
      const message = e?.response?.data?.error;
      if (status === 403 || status === 409) {
        // Un co-examinateur a pris la grille en premier : on bascule en
        // lecture seule sur SA saisie. Le drapeau doit tomber AVANT le
        // rechargement, sinon loadGroupNote refuse d'écraser l'écran.
        resetNoteDirty();
        await loadGroupNote();
        toast(
          message ||
            "Un autre examinateur remplit l'évaluation du groupe : sa saisie s'affiche.",
          "info",
        );
      } else if (status === 503) {
        resetNoteDirty();
        setNoteUnavailable(message || "Évaluation du groupe indisponible.");
      } else {
        console.error("Group note save failed:", e);
        toast(
          message || "Erreur d'enregistrement de l'évaluation du groupe",
          "error",
        );
      }
    }
  };

  const handleNoteScore = (idx: number, val: string, maxPoints: number) => {
    if (!noteCanEdit) return;
    setNoteScores((p) => ({ ...p, [idx]: val }));
    validateScore(idx, val, maxPoints, setNoteErrors);
    const nextErrors = { ...noteErrors };
    if (isInvalidScore(val, maxPoints)) nextErrors[idx] = "invalid";
    else delete nextErrors[idx];
    scheduleNoteSave(
      withoutInvalid({ ...noteScores, [idx]: val }, nextErrors),
      noteComment,
    );
  };

  const handleNoteComment = (val: string) => {
    if (!noteCanEdit) return;
    setNoteComment(val);
    scheduleNoteSave(withoutInvalid(noteScores, noteErrors), val);
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
    // Critères laissés vides : comptés comme 0 plutôt que de bloquer
    // l'enregistrement (25 critères sur certaines épreuves, un oubli ne
    // doit pas empêcher de sauvegarder). On prévient une seule fois.
    const finalScores: Record<number, string> = { ...indivScores };
    let missingCount = 0;
    questions.forEach((_, idx) => {
      if (finalScores[idx] === undefined || finalScores[idx] === "") {
        finalScores[idx] = "0";
        missingCount += 1;
      }
    });
    if (missingCount > 0) {
      toast(
        `${missingCount} critère${missingCount > 1 ? "s" : ""} non noté${missingCount > 1 ? "s" : ""}, compté${missingCount > 1 ? "s" : ""} comme 0.`,
        "info",
      );
    }
    try {
      // Épreuve de groupe : plus aucune note collective à créer ici. Le
      // travail du groupe est noté une seule fois par créneau, sur sa propre
      // grille auto-sauvegardée (/api/evaluations/group-note).
      await api.post("/evaluations", {
        candidateId: id,
        epreuveId: selectedEpreuveId,
        scores: finalScores,
        comment: indivComment,
        isGroup: false,
      });
      toast("Évaluation individuelle enregistrée !", "success");
      router.push("/dashboard/candidates");
    } catch (error: any) {
      console.error(error);
      const code = error?.response?.data?.code;
      // Un pair a noté ce candidat entre-temps (business game) : on recharge
      // pour afficher le panneau « Notation close » plutôt qu'un formulaire
      // qui ne passera plus.
      if (code === "CANDIDATE_ALREADY_EVALUATED") {
        toast(
          error?.response?.data?.error ||
            "Ce candidat vient d'être évalué par un autre examinateur.",
          "info",
        );
        try {
          const epRes = await api.get(
            `/evaluations/allowed-epreuves?candidateId=${id}`,
          );
          setEpreuves(epRes.data?.epreuves || []);
        } catch {
          /* la page reste utilisable */
        }
        return;
      }
      if (
        error?.response?.status === 409 &&
        (code === "GROUP_EVAL_EXISTS" || code === "INDIVIDUAL_EVAL_EXISTS")
      ) {
        // Un 2e examinateur a été ajouté au créneau après le chargement de la
        // page : le serveur note désormais en binôme et une note partagée
        // existe déjà. On recharge les épreuves pour afficher ce panneau.
        toast(
          "Ce créneau est passé en binôme : une note partagée existe déjà, elle s'affiche ci-dessous.",
          "info",
        );
        try {
          const epRes = await api.get(
            `/evaluations/allowed-epreuves?candidateId=${id}`,
          );
          setEpreuves(epRes.data?.epreuves || []);
        } catch {
          /* la page reste utilisable */
        }
        resetGroupDirty();
        return;
      }
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
          {epreuves.length === 0 ? (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
              <p className="text-sm font-medium text-amber-900">
                Aucune épreuve à évaluer pour ce candidat.
              </p>
              <p className="text-xs text-amber-700 mt-1">
                Vous ne pouvez noter un candidat que sur les épreuves où vous
                êtes assigné à son créneau. Rapprochez-vous d&apos;un
                responsable recrutement si vous pensez qu&apos;il s&apos;agit
                d&apos;une erreur.
              </p>
            </div>
          ) : (
            <>
              <select
                className="w-full p-2 border rounded-md"
                value={selectedEpreuveId}
                onChange={(e) => setSelectedEpreuveId(e.target.value)}
                required
              >
                <option value="">-- Sélectionner une épreuve --</option>
                {epreuves.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.type})
                    {e.isGroupEpreuve
                      ? " · groupe"
                      : e.examinerCount >= 2
                        ? " · binôme"
                        : ""}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-2">
                {isAdmin
                  ? "Compte admin : toutes les épreuves sont accessibles."
                  : "Seules les épreuves où vous êtes examinateur de ce candidat sont proposées."}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* ───────── Évaluation DU GROUPE (business game) : une seule grille
          par créneau, remplie par un seul examinateur ───────── */}
      {selectedEpreuve && isGroupEpreuve && (
        <Card className="border-emerald-200">
          <CardHeader className="bg-emerald-50/50">
            <div className="flex items-start justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-emerald-900">
                  👥 Évaluation du groupe
                </CardTitle>
                <p className="text-xs text-emerald-700 mt-1">
                  Elle porte sur le GROUPE, pas sur{" "}
                  {candidate.firstName || "ce candidat"} — une seule grille
                  pour tout le créneau.
                </p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-emerald-700">
                  {totalOf(noteScores)}
                  <span className="text-xs font-medium text-emerald-400">
                    {" "}/ {GROUP_EVALUATION_MAX}
                  </span>
                </p>
                <p className="text-[10px] text-emerald-500 -mt-0.5">
                  Note du groupe
                </p>
                {noteSavedAt && (
                  <p className="text-[11px] text-emerald-600 font-medium mt-1">
                    Enregistrée à{" "}
                    {new Date(noteSavedAt).toLocaleTimeString("fr-FR")}
                  </p>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            {noteUnavailable ? (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
                <p className="text-sm text-amber-900">{noteUnavailable}</p>
              </div>
            ) : noteLoading && !noteId ? (
              <p className="text-sm text-gray-400">Chargement…</p>
            ) : (
              <>
                <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-4 py-2.5">
                  <p className="text-xs text-emerald-800">
                    {noteIsMine && noteId ? (
                      <>
                        Vous avez pris cette grille en main : vous êtes le seul
                        à pouvoir la modifier.
                      </>
                    ) : noteCanEdit ? (
                      <>
                        C&apos;est au{" "}
                        <strong>dernier examinateur du créneau</strong> de
                        remplir cette grille. Si ce n&apos;est pas vous, ne la
                        touchez pas : le premier qui saisit la verrouille pour
                        les autres.
                      </>
                    ) : (
                      <>
                        Remplie par{" "}
                        <strong>
                          {noteOwner?.firstName || noteOwner?.email || "un autre examinateur"}
                        </strong>{" "}
                        — vous pouvez la consulter, pas la modifier.
                      </>
                    )}
                  </p>
                  <p className="text-[11px] text-emerald-600 mt-1">
                    Note indicative : elle éclaire la délibération et
                    n&apos;entre pas dans la moyenne des candidats.
                    Sauvegarde automatique.
                  </p>
                </div>

                <ScoreGrid
                  questions={GROUP_EVALUATION_QUESTIONS}
                  scores={noteScores}
                  scoreErrors={noteErrors}
                  onChange={handleNoteScore}
                  disabled={!noteCanEdit}
                />

                <div className="space-y-2 border-t border-emerald-100 pt-4">
                  <Label>Synthèse sur le groupe</Label>
                  <textarea
                    className="w-full p-2 border rounded-md disabled:bg-gray-50 disabled:text-gray-500"
                    rows={3}
                    value={noteComment}
                    disabled={!noteCanEdit}
                    onChange={(e) => handleNoteComment(e.target.value)}
                    placeholder="Dynamique du groupe, déroulé de l'épreuve, rendu final…"
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ───────── Shared evaluation section : vraie épreuve de groupe, ou
          épreuve individuelle en binôme (2+ examinateurs sur le créneau) ───────── */}
      {selectedEpreuve && showSharedPanel && (
        <Card className="border-indigo-200">
          <CardHeader className="bg-indigo-50/50">
            <div className="flex items-start justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-indigo-900">
                  👥 {isBinome ? "Évaluation partagée (binôme)" : "Évaluation collective"}
                </CardTitle>
                <p className="text-xs text-indigo-700 mt-1">
                  {isBinome
                    ? "Une seule note pour les deux examinateurs du créneau · sauvegarde automatique"
                    : "Partagée entre tous les examinateurs du créneau · sauvegarde automatique"}
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
                <p className="text-[10px] text-indigo-500 -mt-0.5">
                  {isBinome ? "Note du binôme" : "Note collective"}
                </p>
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
                {groupClosedAt ? (
                  <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3">
                    <p className="text-sm font-medium text-gray-800">
                      🔒 Évaluation clôturée
                      {groupClosedBy &&
                        ` par ${groupClosedBy.firstName || groupClosedBy.email}`}{" "}
                      le {new Date(groupClosedAt).toLocaleString("fr-FR")}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      Seul un administrateur peut la rouvrir.
                    </p>
                    {isAdmin && (
                      <Button
                        type="button"
                        variant="outline"
                        className="mt-2"
                        disabled={reopeningEval}
                        onClick={handleReopen}
                      >
                        {reopeningEval ? "Réouverture…" : "Réouvrir (admin)"}
                      </Button>
                    )}
                  </div>
                ) : (
                  isBinome &&
                  groupEvalId &&
                  !groupCanEdit && (
                    <div className="rounded-lg bg-indigo-50 border border-indigo-100 px-4 py-2">
                      <p className="text-xs text-indigo-700">
                        Notée par votre binôme — vous pouvez consulter, commenter
                        et valider, mais pas modifier les points.
                      </p>
                    </div>
                  )
                )}

                <ScoreGrid
                  questions={questions}
                  scores={groupScores}
                  scoreErrors={groupErrors}
                  onChange={handleGroupScore}
                  disabled={!groupCanEdit || !!groupClosedAt}
                />
                <div className="space-y-2 border-t border-indigo-100 pt-4">
                  <Label>Synthèse {isBinome ? "du binôme" : "collective"}</Label>
                  <textarea
                    className="w-full p-2 border rounded-md disabled:bg-gray-50 disabled:text-gray-500"
                    rows={3}
                    value={groupComment}
                    disabled={!groupCanEdit || !!groupClosedAt}
                    onChange={(e) => handleGroupComment(e.target.value)}
                    placeholder="Synthèse partagée, modifiable par tous les examinateurs…"
                  />
                </div>

                {groupEvalId && !groupClosedAt && (
                  <div className="border-t border-indigo-100 pt-4">
                    <Button
                      type="button"
                      className="w-full"
                      disabled={closingEval}
                      onClick={handleValidateClose}
                    >
                      {closingEval
                        ? "Clôture…"
                        : "✓ Valider et clôturer la notation"}
                    </Button>
                    <p className="text-[11px] text-gray-500 mt-1 text-center">
                      Clôture la note pour tout le monde — seul un admin
                      pourra ensuite la rouvrir.
                    </p>
                  </div>
                )}

              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ───────── Fil de commentaires du créneau (groupe ou binôme) ───────── */}
      {selectedEpreuve && showComments && (
        <Card>
          <CardHeader>
            <CardTitle>Commentaires du groupe</CardTitle>
            <p className="text-xs text-gray-500 mt-1">
              Visible par tous les examinateurs du créneau — chacun peut en
              ajouter. Mise à jour automatique toutes les 7 secondes.
            </p>
          </CardHeader>
          <CardContent>
                <div className="space-y-2">
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
          </CardContent>
        </Card>
      )}

      {/* ───────── Notation close : le candidat a déjà sa note sur cette
          épreuve. On montre par qui plutôt qu'un formulaire qui ne pourra
          jamais être enregistré (le serveur applique la même règle). ───────── */}
      {selectedEpreuve && !isBinome && indivClosed && (
        <Card className="border-gray-300">
          <CardHeader className="bg-gray-50">
            <CardTitle className="flex items-center gap-2 text-gray-800">
              🔒 Notation close
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-5">
            <p className="text-sm text-gray-700">
              {closureReason === "mine" ? (
                <>
                  Vous avez déjà évalué {candidate.firstName || "ce candidat"}{" "}
                  sur cette épreuve.
                </>
              ) : closureReason === "shared" ? (
                <>
                  La note de ce candidat a été saisie en binôme par{" "}
                  <strong>{closureAuthor}</strong> — elle compte pour vous deux.
                </>
              ) : (
                <>
                  {candidate.firstName || "Ce candidat"} a déjà été évalué par{" "}
                  <strong>{closureAuthor}</strong> sur cette épreuve.
                </>
              )}
            </p>
            <p className="text-xs text-gray-500 mt-2">
              {closureReason === "peer"
                ? "Sur un business game, chaque candidat n'est noté qu'une fois, par l'examinateur qui l'a observé."
                : "Une seule note par candidat et par épreuve."}{" "}
              Contactez un responsable recrutement s&apos;il faut la corriger.
            </p>
            <a
              href={`/dashboard/candidates/${id}`}
              className="inline-flex items-center mt-4 text-sm font-medium text-blue-600 hover:underline"
            >
              Voir la fiche du candidat
            </a>
          </CardContent>
        </Card>
      )}

      {/* ───────── Individual evaluation section (masquée en binôme : une
          seule note partagée existe déjà ci-dessus) ───────── */}
      {selectedEpreuve && !isBinome && !indivClosed && (
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
