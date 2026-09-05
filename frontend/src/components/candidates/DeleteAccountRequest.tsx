"use client";

import { useCallback, useEffect, useState } from "react";
import api from "@/lib/api";
import { Loader2 } from "lucide-react";

/** Adresse affichée en secours si l'envoi échoue. */
const ADMIN_EMAIL = "systeme.info@ajc-mail.com";
const MOTIF_MAX = 1000;

/**
 * Au-delà, on abandonne l'attente. La modale se verrouille pendant l'envoi ;
 * sans cette borne, une requête qui ne revient jamais y enfermerait
 * l'utilisateur pour la durée de vie de l'onglet.
 */
const TIMEOUT_MS = 15_000;

type State = "idle" | "sending" | "sent" | "error";

/**
 * Demande de suppression de compte — volontairement discrète : un lien en
 * petits caractères sous les informations du candidat.
 *
 * La modale ne promet que ce que le système fait réellement : la demande part
 * vers l'équipe recrutement, qui la traite à la main. Rien n'est supprimé ici.
 */
export default function DeleteAccountRequest() {
  const [open, setOpen] = useState(false);
  const [motif, setMotif] = useState("");
  const [state, setState] = useState<State>("idle");

  const close = useCallback(() => {
    // Pendant l'envoi, aucune sortie — ni bouton, ni Échap. La requête est déjà
    // partie : laisser fermer ferait croire à une annulation alors que la
    // demande aboutirait quand même.
    if (state === "sending") return;
    setOpen(false);
    // Une demande partie ne se rétracte pas : on ne réarme que si elle a échoué.
    if (state === "error") setState("idle");
  }, [state]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  async function submit() {
    setState("sending");
    try {
      await api.post(
        "/candidates/delete-request",
        { motif },
        { timeout: TIMEOUT_MS },
      );
      setState("sent");
    } catch {
      // Inclut l'abandon sur délai. La demande a pu aboutir côté serveur malgré
      // tout ; l'équipe recrutement recevra alors l'email.
      setState("error");
    }
  }

  return (
    <>
      <div className="text-center">
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={state === "sent"}
          className="text-xs text-gray-400 underline underline-offset-2 hover:text-gray-600 transition-colors disabled:no-underline disabled:hover:text-gray-400"
        >
          {state === "sent"
            ? "Demande de suppression envoyée"
            : "Demander la suppression de mon compte"}
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="titre-suppression-compte"
            onClick={(e) => e.stopPropagation()}
            className="bg-white border border-gray-200 rounded-xl shadow-xl w-full max-w-md p-6"
          >
            {state === "sent" ? (
              <>
                <h2
                  id="titre-suppression-compte"
                  className="text-lg font-semibold text-gray-900"
                >
                  Demande envoyée
                </h2>
                <p className="text-sm text-gray-600 mt-2 leading-relaxed">
                  L&apos;équipe recrutement a été prévenue et traitera votre
                  demande manuellement.
                </p>
                <div className="flex justify-end mt-6">
                  <button
                    type="button"
                    onClick={close}
                    className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-gray-800 transition-colors"
                  >
                    Fermer
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2
                  id="titre-suppression-compte"
                  className="text-lg font-semibold text-gray-900"
                >
                  Demander la suppression de mon compte
                </h2>
                <p className="text-sm text-gray-600 mt-2 leading-relaxed">
                  Votre demande est transmise à l&apos;équipe recrutement
                  d&apos;Audencia Junior Conseil. La suppression n&apos;est pas
                  immédiate : elle est effectuée manuellement, et elle est
                  définitive — votre candidature sera retirée du processus.
                </p>

                <label
                  htmlFor="motif-suppression-compte"
                  className="block text-xs font-medium text-gray-500 mt-5 mb-1.5"
                >
                  Motif (facultatif)
                </label>
                <textarea
                  id="motif-suppression-compte"
                  value={motif}
                  onChange={(e) => setMotif(e.target.value)}
                  rows={3}
                  maxLength={MOTIF_MAX}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-200"
                />

                {state === "error" && (
                  <p className="text-sm text-[#B3244A] mt-3">
                    L&apos;envoi a échoué. Réessayez, ou écrivez directement à{" "}
                    {ADMIN_EMAIL}.
                  </p>
                )}

                <div className="flex justify-end gap-2 mt-6">
                  <button
                    type="button"
                    onClick={close}
                    disabled={state === "sending"}
                    className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={state === "sending"}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#E8446A] text-white text-sm font-semibold hover:bg-[#c0395a] transition-colors disabled:opacity-50"
                  >
                    {state === "sending" && (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                    {state === "sending" ? "Envoi…" : "Envoyer la demande"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
