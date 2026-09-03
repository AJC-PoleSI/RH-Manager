"use client";

// Espace candidat — « Mon profil ».
//
// Créée pour la photo du trombinoscope : le jury a besoin d'un visage associé
// à un nom pour s'y retrouver entre les entretiens et la soirée délibération.
// Le candidat y voit aussi, en lecture seule, ce que l'association a de lui.

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import api from "@/lib/api";
import CandidatePhotoUpload from "@/components/forms/CandidatePhotoUpload";
import { Loader2, ShieldCheck } from "lucide-react";

export default function CandidateProfilePage() {
  const { user } = useAuth();
  const [candidate, setCandidate] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res = await api.get(`/candidates/${user.id}`);
      setCandidate(res.data);
    } catch {
      setCandidate(null);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="animate-spin text-gray-400" size={28} />
      </div>
    );
  }

  if (!candidate) {
    return (
      <div className="max-w-3xl mx-auto py-12 text-center text-gray-500">
        Profil indisponible pour le moment.
      </div>
    );
  }

  const hasPhoto = !!candidate.hasPhoto;

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Mon profil</h1>
        <p className="text-sm text-gray-500 mt-1">
          Votre photo et vos informations d&apos;inscription.
        </p>
      </div>

      {/* Relance tant que la photo manque : c'est le seul élément que le
          candidat doit fournir ici, autant le dire clairement. */}
      {!hasPhoto && (
        <div className="bg-[#FFF0F3] border border-[#FFD3DC] rounded-xl px-4 py-3">
          <p className="text-sm font-semibold text-[#B3244A]">
            Il manque votre photo
          </p>
          <p className="text-sm text-[#8A2340] mt-0.5">
            Les membres du jury rencontrent des dizaines de candidats. Une photo
            leur permet de vous associer à votre nom lors des délibérations.
            Cela ne prend que quelques secondes et n&apos;est pas noté.
          </p>
        </div>
      )}

      <section className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Ma photo</h2>
        <CandidatePhotoUpload
          candidateId={candidate.id}
          firstName={candidate.firstName}
          lastName={candidate.lastName}
          initialHasPhoto={hasPhoto}
          onChange={(next) =>
            setCandidate((prev: any) => ({ ...prev, hasPhoto: next }))
          }
        />
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">
          Mes informations
        </h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
          <Field label="Prénom" value={candidate.firstName} />
          <Field label="Nom" value={candidate.lastName} />
          <Field label="Email" value={candidate.email} />
          <Field label="Téléphone" value={candidate.phone} />
          <Field label="Formation" value={candidate.formation} />
          <Field label="Établissement" value={candidate.etablissement} />
        </dl>
        <p className="flex items-start gap-2 text-xs text-gray-500 mt-5 pt-4 border-t border-gray-100">
          <ShieldCheck size={14} className="mt-0.5 flex-shrink-0" />
          <span>
            Votre photo n&apos;est visible que par les membres d&apos;Audencia
            Junior Conseil impliqués dans le recrutement. Elle est supprimée
            avec votre candidature et vous pouvez la retirer à tout moment.
          </span>
        </p>
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium text-gray-400 uppercase tracking-wide">
        {label}
      </dt>
      <dd className="text-gray-900 mt-0.5">{value || "—"}</dd>
    </div>
  );
}
