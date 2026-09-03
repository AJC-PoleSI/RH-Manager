"use client";

// Dépôt de la photo d'un candidat.
//
// Utilisé par le candidat sur son propre profil, et par un admin sur la fiche
// d'un candidat (dépannage : le candidat n'a pas déposé de photo et l'équipe
// en a une). Le redimensionnement se fait dans le navigateur — une photo de
// téléphone brute dépasse largement le plafond de l'API.

import { useRef, useState } from "react";
import api from "@/lib/api";
import { Camera, Loader2, Trash2, Upload } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import CandidatePhoto from "@/components/ui/CandidatePhoto";
import { invalidateCandidatePhoto } from "@/lib/photo-cache";
import { PHOTO_ACCEPT, resizePhotoFile } from "@/lib/photo-resize";

interface Props {
  candidateId: string;
  firstName?: string | null;
  lastName?: string | null;
  /** Photo déjà présente au chargement de la page. */
  initialHasPhoto?: boolean;
  size?: number;
  /** Prévenir le parent (pour retirer le bandeau de relance, par exemple). */
  onChange?: (hasPhoto: boolean) => void;
}

export default function CandidatePhotoUpload({
  candidateId,
  firstName,
  lastName,
  initialHasPhoto = false,
  size = 160,
  onChange,
}: Props) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [hasPhoto, setHasPhoto] = useState(initialHasPhoto);
  const [version, setVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await resizePhotoFile(file);
      await api.put(`/candidates/${candidateId}/photo`, { dataUrl });

      // Le cache est indexé par (candidat, version) : on le purge et on force
      // une nouvelle version pour que la vignette se rafraîchisse partout.
      invalidateCandidatePhoto(candidateId);
      setVersion(new Date().toISOString());
      setHasPhoto(true);
      onChange?.(true);
      toast("Photo enregistrée.", "success");
    } catch (err: any) {
      toast(
        err?.response?.data?.error ||
          err?.message ||
          "Échec de l'envoi de la photo.",
        "error",
      );
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      await api.delete(`/candidates/${candidateId}/photo`);
      invalidateCandidatePhoto(candidateId);
      setVersion(new Date().toISOString());
      setHasPhoto(false);
      onChange?.(false);
      toast("Photo supprimée.", "success");
    } catch (err: any) {
      toast(
        err?.response?.data?.error || "Échec de la suppression.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col sm:flex-row items-center gap-5">
      <div className="relative">
        <CandidatePhoto
          candidateId={candidateId}
          firstName={firstName}
          lastName={lastName}
          hasPhoto={hasPhoto}
          version={version}
          size={size}
          rounded="rounded-2xl"
          className="ring-1 ring-gray-200"
        />
        {busy && (
          <div className="absolute inset-0 bg-white/70 rounded-2xl flex items-center justify-center">
            <Loader2 className="animate-spin text-gray-500" size={24} />
          </div>
        )}
      </div>

      <div className="flex-1 text-center sm:text-left">
        <input
          ref={inputRef}
          type="file"
          accept={PHOTO_ACCEPT}
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />

        <div className="flex flex-wrap justify-center sm:justify-start gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            {hasPhoto ? <Upload size={15} /> : <Camera size={15} />}
            {hasPhoto ? "Changer la photo" : "Ajouter une photo"}
          </button>

          {hasPhoto && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <Trash2 size={15} />
              Retirer
            </button>
          )}
        </div>

        <p className="text-xs text-gray-500 mt-3 leading-relaxed max-w-sm">
          Une photo de visage, cadrée simplement — elle sert au jury à vous
          reconnaître le jour des entretiens. JPEG, PNG ou WebP.
          L&apos;image est automatiquement recadrée en carré et réduite avant
          l&apos;envoi.
        </p>
      </div>
    </div>
  );
}
