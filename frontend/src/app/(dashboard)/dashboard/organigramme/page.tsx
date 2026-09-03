"use client";

// Organigramme des candidats — le trombinoscope du jury.
//
// Deux usages dans la même page :
//   • Retrouver un visage : photo + prénom/nom, tout le monde au même endroit.
//   • Donner ses coups de cœur : 5 par membre pour tout le recrutement, un
//     seul par candidat. Un membre ne voit que SES cœurs ; l'admin voit ceux
//     de tout le monde et peut s'en servir en délibération.
//
// Les candidats refusés à un tour tombent en fin de liste et sont grisés : ils
// restent consultables (on veut pouvoir dire « ah oui, lui ») sans polluer la
// lecture de ceux qui sont encore en lice.

import { useCallback, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/toast";
import CandidatePhoto from "@/components/ui/CandidatePhoto";
import { AlertTriangle, Heart, Loader2, Search, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface OrganigrammeCandidate {
  id: string;
  firstName: string;
  lastName: string;
  hasPhoto: boolean;
  photoUpdatedAt: string | null;
  eliminated: boolean;
  eliminatedAtTour: number | null;
  firstWish: string | null;
  isFavorite: boolean;
  favoritesCount: number;
  favoritedBy: string[];
}

interface Quota {
  max: number;
  used: number;
  remaining: number;
  onEliminated: number;
}

export default function OrganigrammePage() {
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;
  const { toast } = useToast();

  const [candidates, setCandidates] = useState<OrganigrammeCandidate[]>([]);
  const [quota, setQuota] = useState<Quota>({
    max: 5,
    used: 0,
    remaining: 5,
    onEliminated: 0,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [voters, setVoters] = useState<OrganigrammeCandidate | null>(null);
  // Vrai tant que le SQL n'a pas été passé dans Supabase : la page reste
  // lisible (identités + statuts) mais photos et cœurs sont inertes.
  const [migrationPending, setMigrationPending] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get("/organigramme");
      setCandidates(res.data.candidates || []);
      setQuota(res.data.favorites);
      setMigrationPending(!!res.data.migrationPending);
    } catch (err: any) {
      toast(
        err?.response?.data?.error || "Échec du chargement de l'organigramme.",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Bascule un cœur. Optimiste : le cœur se remplit tout de suite, et l'état
   * revient en arrière si le serveur refuse (quota atteint, notamment).
   */
  const toggleFavorite = async (c: OrganigrammeCandidate) => {
    if (pending) return;
    const next = !c.isFavorite;

    if (next && !c.eliminated && quota.remaining <= 0) {
      toast(
        `Vos ${quota.max} coups de cœur sont déjà donnés. Retirez-en un d'abord.`,
        "error",
      );
      return;
    }

    setPending(c.id);
    setCandidates((prev) =>
      prev.map((x) => (x.id === c.id ? { ...x, isFavorite: next } : x)),
    );

    try {
      const res = await api.post("/favorites", {
        candidateId: c.id,
        favorite: next,
      });
      setQuota(res.data.favorites);
      if (isAdmin) {
        // Le décompte global n'est visible que de l'admin : on le recale
        // localement plutôt que de recharger toute la page.
        setCandidates((prev) =>
          prev.map((x) =>
            x.id === c.id
              ? {
                  ...x,
                  favoritesCount: Math.max(0, x.favoritesCount + (next ? 1 : -1)),
                }
              : x,
          ),
        );
      }
    } catch (err: any) {
      setCandidates((prev) =>
        prev.map((x) => (x.id === c.id ? { ...x, isFavorite: !next } : x)),
      );
      if (err?.response?.data?.favorites) setQuota(err.response.data.favorites);
      toast(
        err?.response?.data?.error || "Échec de l'enregistrement du coup de cœur.",
        "error",
      );
    } finally {
      setPending(null);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return candidates.filter((c) => {
      if (favoritesOnly && !c.isFavorite) return false;
      if (!q) return true;
      return `${c.firstName} ${c.lastName}`.toLowerCase().includes(q);
    });
  }, [candidates, search, favoritesOnly]);

  const active = filtered.filter((c) => !c.eliminated);
  const eliminated = filtered.filter((c) => c.eliminated);

  // Classement des coups de cœur : lecture utile en délibération, réservée à
  // l'admin puisque lui seul voit les votes des autres.
  const ranking = useMemo(() => {
    if (!isAdmin) return [];
    return candidates
      .filter((c) => c.favoritesCount > 0)
      .sort(
        (a, b) =>
          b.favoritesCount - a.favoritesCount ||
          a.lastName.localeCompare(b.lastName),
      )
      .slice(0, 10);
  }, [candidates, isAdmin]);

  const withoutPhoto = candidates.filter((c) => !c.hasPhoto).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="animate-spin text-gray-400" size={28} />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Organigramme</h1>
          <p className="text-sm text-gray-500 mt-1">
            Les visages du recrutement, et vos coups de cœur.
          </p>
        </div>

        {/* Quota de cœurs */}
        <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-2.5">
          <div className="flex items-center gap-1">
            {Array.from({ length: quota.max }).map((_, i) => (
              <Heart
                key={i}
                size={16}
                className={
                  i < quota.used ? "text-rose-500" : "text-gray-200"
                }
                fill={i < quota.used ? "currentColor" : "none"}
              />
            ))}
          </div>
          <div className="text-sm leading-tight">
            <span className="font-semibold text-gray-900">
              {quota.used} / {quota.max}
            </span>
            <span className="text-gray-500"> coups de cœur</span>
          </div>
        </div>
      </div>

      {/* La migration SQL de ce dépôt se pose à la main : le dire ici évite de
          chercher pourquoi rien ne s'enregistre. */}
      {migrationPending && (
        <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertTriangle
            size={18}
            className="text-amber-600 mt-0.5 flex-shrink-0"
          />
          <div className="text-sm">
            <p className="font-semibold text-amber-900">
              Photos et coups de cœur pas encore activés
            </p>
            <p className="text-amber-800">
              La migration{" "}
              <code className="text-xs bg-amber-100 px-1 py-0.5 rounded">
                supabase-migration-photos-coups-de-coeur.sql
              </code>{" "}
              reste à exécuter dans le SQL Editor de Supabase (elle est aussi
              en section 6 de MIGRATIONS_A_APPLIQUER.sql). D&apos;ici là, les
              candidats s&apos;affichent avec leurs initiales et les cœurs ne
              s&apos;enregistrent pas.
            </p>
          </div>
        </div>
      )}

      {/* Explication du quota */}
      <div className="bg-rose-50 border border-rose-100 rounded-xl px-4 py-3 text-sm text-rose-900">
        Vous disposez de <strong>{quota.max} coups de cœur</strong> pour tout le
        recrutement, un seul par candidat.{" "}
        {isAdmin
          ? "En tant qu'admin, vous voyez aussi les coups de cœur de toute l'équipe."
          : "Vos coups de cœur ne sont visibles que par vous et les admins."}{" "}
        Un cœur donné à un candidat qui est ensuite refusé vous est rendu
        {quota.onEliminated > 0
          ? ` (c'est déjà le cas de ${quota.onEliminated} de vos cœurs).`
          : "."}
      </div>

      {/* Filtres */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un candidat…"
            className="w-full pl-9 pr-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <button
          onClick={() => setFavoritesOnly((v) => !v)}
          className={cn(
            "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors whitespace-nowrap",
            favoritesOnly
              ? "bg-rose-500 border-rose-500 text-white"
              : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50",
          )}
        >
          <Heart size={15} fill={favoritesOnly ? "currentColor" : "none"} />
          Mes coups de cœur
        </button>
      </div>

      {/* Classement admin */}
      {isAdmin && ranking.length > 0 && (
        <section className="bg-white border border-gray-200 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">
            Coups de cœur de l&apos;équipe
          </h2>
          <div className="flex flex-wrap gap-2">
            {ranking.map((c) => (
              <button
                key={c.id}
                onClick={() => setVoters(c)}
                className={cn(
                  "inline-flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full border text-sm transition-colors",
                  c.eliminated
                    ? "bg-gray-50 border-gray-200 text-gray-400"
                    : "bg-rose-50 border-rose-200 text-rose-900 hover:bg-rose-100",
                )}
              >
                <CandidatePhoto
                  candidateId={c.id}
                  firstName={c.firstName}
                  lastName={c.lastName}
                  hasPhoto={c.hasPhoto}
                  version={c.photoUpdatedAt}
                  size={24}
                  grayscale={c.eliminated}
                />
                <span className="font-medium">
                  {c.firstName} {c.lastName}
                </span>
                <span className="inline-flex items-center gap-0.5 font-bold">
                  <Heart size={12} fill="currentColor" />
                  {c.favoritesCount}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Relance photos (admin) */}
      {isAdmin && withoutPhoto > 0 && (
        <p className="text-sm text-gray-500">
          {withoutPhoto} candidat{withoutPhoto > 1 ? "s n'ont" : " n'a"} pas
          encore déposé de photo — leurs initiales sont affichées à la place.
        </p>
      )}

      {/* En lice */}
      <Section
        title="En lice"
        count={active.length}
        candidates={active}
        isAdmin={isAdmin}
        pending={pending}
        quotaFull={quota.remaining <= 0}
        onToggle={toggleFavorite}
        onShowVoters={setVoters}
      />

      {/* Éliminés — en bas de page, grisés */}
      {eliminated.length > 0 && (
        <Section
          title="Plus dans la course"
          count={eliminated.length}
          candidates={eliminated}
          isAdmin={isAdmin}
          pending={pending}
          quotaFull={false} /* un cœur sur un éliminé ne coûte rien */
          onToggle={toggleFavorite}
          onShowVoters={setVoters}
        />
      )}

      {filtered.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <Users size={32} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">Aucun candidat ne correspond à cette recherche.</p>
        </div>
      )}

      {/* Détail des votants (admin) */}
      {voters && isAdmin && (
        <div
          className="fixed inset-0 bg-black/40 z-[90] flex items-center justify-center p-4"
          onClick={() => setVoters(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-sm w-full p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <CandidatePhoto
                  candidateId={voters.id}
                  firstName={voters.firstName}
                  lastName={voters.lastName}
                  hasPhoto={voters.hasPhoto}
                  version={voters.photoUpdatedAt}
                  size={44}
                  grayscale={voters.eliminated}
                />
                <div>
                  <p className="font-semibold text-gray-900">
                    {voters.firstName} {voters.lastName}
                  </p>
                  <p className="text-xs text-gray-500">
                    {voters.favoritesCount} coup
                    {voters.favoritesCount > 1 ? "s" : ""} de cœur
                  </p>
                </div>
              </div>
              <button
                onClick={() => setVoters(null)}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Fermer"
              >
                <X size={18} />
              </button>
            </div>
            {voters.favoritedBy.length > 0 ? (
              <ul className="space-y-1.5 text-sm text-gray-700">
                {voters.favoritedBy.map((name) => (
                  <li key={name} className="flex items-center gap-2">
                    <Heart size={13} className="text-rose-500" fill="currentColor" />
                    {name}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-500">Aucun coup de cœur.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── */

function Section({
  title,
  count,
  candidates,
  isAdmin,
  pending,
  quotaFull,
  onToggle,
  onShowVoters,
}: {
  title: string;
  count: number;
  candidates: OrganigrammeCandidate[];
  isAdmin: boolean;
  pending: string | null;
  quotaFull: boolean;
  onToggle: (c: OrganigrammeCandidate) => void;
  onShowVoters: (c: OrganigrammeCandidate) => void;
}) {
  if (candidates.length === 0) return null;

  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
        {title} · {count}
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {candidates.map((c) => (
          <CandidateTile
            key={c.id}
            candidate={c}
            isAdmin={isAdmin}
            busy={pending === c.id}
            // Le quota ne bloque jamais le retrait d'un cœur déjà donné.
            blocked={quotaFull && !c.isFavorite}
            onToggle={onToggle}
            onShowVoters={onShowVoters}
          />
        ))}
      </div>
    </section>
  );
}

function CandidateTile({
  candidate: c,
  isAdmin,
  busy,
  blocked,
  onToggle,
  onShowVoters,
}: {
  candidate: OrganigrammeCandidate;
  isAdmin: boolean;
  busy: boolean;
  blocked: boolean;
  onToggle: (c: OrganigrammeCandidate) => void;
  onShowVoters: (c: OrganigrammeCandidate) => void;
}) {
  return (
    <div
      className={cn(
        "relative bg-white border rounded-xl overflow-hidden transition-shadow hover:shadow-md",
        c.eliminated ? "border-gray-200 bg-gray-50" : "border-gray-200",
      )}
    >
      <a
        href={`/dashboard/candidates/${c.id}`}
        className="block p-3 pb-2"
        title={`Fiche de ${c.firstName} ${c.lastName}`}
      >
        <CandidatePhoto
          candidateId={c.id}
          firstName={c.firstName}
          lastName={c.lastName}
          hasPhoto={c.hasPhoto}
          version={c.photoUpdatedAt}
          size={72}
          fill
          grayscale={c.eliminated}
          rounded="rounded-lg"
        />
        <p
          className={cn(
            "mt-2 text-sm font-semibold leading-tight truncate",
            c.eliminated ? "text-gray-400" : "text-gray-900",
          )}
        >
          {c.firstName}
        </p>
        <p
          className={cn(
            "text-sm leading-tight truncate",
            c.eliminated ? "text-gray-400" : "text-gray-600",
          )}
        >
          {c.lastName}
        </p>
        {c.eliminated ? (
          <p className="text-[11px] text-gray-400 mt-1">
            Refusé{c.eliminatedAtTour ? ` au Tour ${c.eliminatedAtTour}` : ""}
          </p>
        ) : (
          c.firstWish && (
            <p className="text-[11px] text-gray-400 mt-1 truncate">
              {c.firstWish}
            </p>
          )
        )}
      </a>

      <div className="flex items-center justify-between px-3 pb-3 pt-1">
        <button
          onClick={() => onToggle(c)}
          disabled={busy || blocked}
          title={
            blocked
              ? "Vos coups de cœur sont tous donnés"
              : c.isFavorite
                ? "Retirer mon coup de cœur"
                : "Coup de cœur"
          }
          className={cn(
            "inline-flex items-center justify-center w-8 h-8 rounded-full border transition-all",
            c.isFavorite
              ? "bg-rose-500 border-rose-500 text-white hover:bg-rose-600"
              : "bg-white border-gray-200 text-gray-300 hover:text-rose-400 hover:border-rose-200",
            (busy || blocked) && "opacity-40 cursor-not-allowed",
          )}
          aria-pressed={c.isFavorite}
          aria-label={`Coup de cœur pour ${c.firstName} ${c.lastName}`}
        >
          {busy ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Heart size={15} fill={c.isFavorite ? "currentColor" : "none"} />
          )}
        </button>

        {isAdmin && c.favoritesCount > 0 && (
          <button
            onClick={() => onShowVoters(c)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-rose-50 text-rose-700 text-xs font-bold hover:bg-rose-100 transition-colors"
            title="Voir qui a donné un coup de cœur"
          >
            <Heart size={11} fill="currentColor" />
            {c.favoritesCount}
          </button>
        )}
      </div>
    </div>
  );
}
