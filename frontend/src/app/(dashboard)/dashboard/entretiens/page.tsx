"use client";

/**
 * « Liste à copier » — écran admin.
 *
 * Un seul but : produire, pour une journée donnée, un bloc de texte brut
 * (heure — candidat — salle) qu'on colle tel quel dans un message ou qu'on
 * imprime. La mise en forme vit dans lib/entretiens-export.ts (pure, testée) ;
 * cette page ne fait que la piloter.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  Download,
  Loader2,
  RefreshCw,
} from "lucide-react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { localYmd } from "@/lib/availability-bands";
import {
  DEFAULT_FORMAT_OPTIONS,
  formatEntretiens,
  trierEntretiens,
  nomComplet,
  type EntretienLigne,
  type FormatOptions,
} from "@/lib/entretiens-export";

/** "YYYY-MM-DD" ± n jours, sans jamais passer par un fuseau. */
function decalerJour(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const jour = new Date(y, m - 1, d, 12, 0, 0);
  jour.setDate(jour.getDate() + delta);
  return localYmd(jour);
}

export default function EntretiensPage() {
  const { toast } = useToast();
  const aujourdHui = useMemo(() => localYmd(new Date()), []);

  const [date, setDate] = useState(aujourdHui);
  const [entretiens, setEntretiens] = useState<EntretienLigne[]>([]);
  const [datesDisponibles, setDatesDisponibles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [copie, setCopie] = useState(false);
  const [options, setOptions] = useState<FormatOptions>(DEFAULT_FORMAT_OPTIONS);

  const charger = useCallback(
    async (jour: string) => {
      setLoading(true);
      setErreur(null);
      try {
        const res = await api.get("/entretiens", { params: { date: jour } });
        setEntretiens(res.data.entretiens || []);
        setDatesDisponibles(res.data.datesDisponibles || []);
      } catch (e: any) {
        setEntretiens([]);
        setErreur(
          e?.response?.status === 403
            ? "Cet espace est réservé aux administrateurs."
            : "Impossible de charger les entretiens (bloqueur de publicité ou problème réseau ?).",
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    charger(date);
  }, [date, charger]);

  const texte = useMemo(
    () => formatEntretiens(date, aujourdHui, entretiens, options),
    [date, aujourdHui, entretiens, options],
  );

  const lignesTriees = useMemo(() => trierEntretiens(entretiens), [entretiens]);
  const nbCandidats = useMemo(
    () => entretiens.reduce((n, e) => n + e.candidats.length, 0),
    [entretiens],
  );
  const nbVides = useMemo(
    () => entretiens.filter((e) => e.candidats.length === 0).length,
    [entretiens],
  );

  const copier = async () => {
    try {
      // `navigator.clipboard` n'existe pas hors HTTPS/localhost : repli sur
      // la sélection du textarea, sinon le bouton ne ferait rien du tout.
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(texte);
      } else {
        const zone = document.getElementById(
          "entretiens-texte",
        ) as HTMLTextAreaElement | null;
        if (!zone) throw new Error("zone introuvable");
        zone.select();
        document.execCommand("copy");
      }
      setCopie(true);
      setTimeout(() => setCopie(false), 2000);
      toast("Liste copiée dans le presse-papier", "success");
    } catch {
      toast("Copie impossible — sélectionnez le texte à la main", "error");
    }
  };

  const telecharger = () => {
    const blob = new Blob([texte], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `entretiens-${date}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const Case = ({
    champ,
    label,
  }: {
    champ: keyof FormatOptions;
    label: string;
  }) => (
    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
        checked={options[champ]}
        onChange={(e) =>
          setOptions((o) => ({ ...o, [champ]: e.target.checked }))
        }
      />
      {label}
    </label>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ClipboardCopy size={22} className="text-primary-600" />
          Liste à copier
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          La liste des entretiens d&apos;une journée, en texte brut, prête à
          coller dans un message.
        </p>
      </div>

      {/* Barre de date */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setDate((d) => decalerJour(d, -1))}
          aria-label="Jour précédent"
        >
          <ChevronLeft size={16} />
        </Button>
        <div className="relative">
          <CalendarDays
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          />
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="h-8 pl-9 pr-3 rounded-md border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setDate((d) => decalerJour(d, 1))}
          aria-label="Jour suivant"
        >
          <ChevronRight size={16} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDate(aujourdHui)}
          disabled={date === aujourdHui}
        >
          Aujourd&apos;hui
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => charger(date)}
          aria-label="Rafraîchir"
        >
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
        </Button>
      </div>

      {/* Jours qui portent des créneaux — évite de chercher à l'aveugle */}
      {datesDisponibles.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {datesDisponibles.map((d) => {
            const [, m, j] = d.split("-");
            return (
              <button
                key={d}
                onClick={() => setDate(d)}
                className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                  d === date
                    ? "bg-primary-600 border-primary-600 text-white"
                    : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                {j}/{m}
                {d === aujourdHui ? " ·" : ""}
              </button>
            );
          })}
        </div>
      )}

      {erreur ? (
        <p className="text-gray-500 bg-gray-50 border border-gray-100 rounded-lg p-6 text-center">
          {erreur}
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Colonne texte */}
          <div className="lg:col-span-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-gray-500">
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" /> Chargement…
                  </span>
                ) : (
                  <>
                    {entretiens.length} créneau
                    {entretiens.length > 1 ? "x" : ""} · {nbCandidats} candidat
                    {nbCandidats > 1 ? "s" : ""}
                    {nbVides > 0 && (
                      <span className="text-amber-600">
                        {" "}
                        · {nbVides} sans candidat
                      </span>
                    )}
                  </>
                )}
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={telecharger}>
                  <Download size={15} className="mr-1.5" />
                  .txt
                </Button>
                <Button size="sm" onClick={copier}>
                  {copie ? (
                    <Check size={15} className="mr-1.5" />
                  ) : (
                    <ClipboardCopy size={15} className="mr-1.5" />
                  )}
                  {copie ? "Copié" : "Copier"}
                </Button>
              </div>
            </div>

            {/* Modifiable : on peut retoucher le texte avant de le copier. */}
            <textarea
              id="entretiens-texte"
              value={texte}
              onChange={() => {}}
              readOnly
              spellCheck={false}
              rows={Math.min(30, Math.max(10, texte.split("\n").length + 1))}
              className="w-full rounded-lg border border-gray-200 bg-gray-50 p-4 font-mono text-sm text-gray-800 leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {/* Colonne options + aperçu tableau */}
          <div className="lg:col-span-2 space-y-4">
            <div className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm space-y-2.5">
              <p className="text-sm font-semibold text-gray-900">
                Contenu de la liste
              </p>
              <Case
                champ="unLigneParCandidat"
                label="Une ligne par candidat (épreuves de groupe)"
              />
              <Case champ="avecHeureFin" label="Afficher l'heure de fin" />
              <Case champ="avecEpreuve" label="Ajouter l'épreuve" />
              <Case champ="avecJury" label="Ajouter le jury" />
              <Case
                champ="masquerVides"
                label="Masquer les créneaux sans candidat"
              />
            </div>

            <div className="rounded-lg border border-gray-100 bg-white shadow-sm overflow-hidden">
              <p className="text-sm font-semibold text-gray-900 px-4 py-3 border-b border-gray-100">
                Aperçu
              </p>
              <div className="max-h-[420px] overflow-y-auto">
                {lignesTriees.length === 0 ? (
                  <p className="text-sm text-gray-500 p-4">
                    Aucun créneau ce jour-là.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {lignesTriees.map((e) => (
                        <tr
                          key={e.id}
                          className="border-b border-gray-50 last:border-0"
                        >
                          <td className="px-4 py-2 whitespace-nowrap text-gray-500 tabular-nums align-top">
                            {e.startTime}
                          </td>
                          <td className="px-2 py-2 text-gray-900">
                            {e.candidats.length === 0 ? (
                              <span className="text-amber-600">
                                — sans candidat —
                              </span>
                            ) : (
                              e.candidats.map(nomComplet).join(", ")
                            )}
                            <span className="block text-xs text-gray-400">
                              {e.epreuve}
                            </span>
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap text-gray-600 align-top">
                            {e.room || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
