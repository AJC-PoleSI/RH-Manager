"use client";

import { useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

const RULES = [
  { test: (p: string) => p.length >= 8, label: "8 caractères minimum" },
  { test: (p: string) => /[A-Z]/.test(p), label: "au moins une majuscule" },
  { test: (p: string) => /[0-9]/.test(p), label: "au moins un chiffre" },
];

interface Props {
  /** Mode imposé : pas de croix, pas de fermeture au clic extérieur. */
  forced?: boolean;
  onClose?: () => void;
  onSuccess?: () => void;
}

/**
 * Changement de mot de passe en session. Sert aux deux cas :
 *   • `forced` — le compte est marqué « doit changer son mot de passe »,
 *     l'écran est bloquant tant que ce n'est pas fait ;
 *   • libre — depuis le menu « Mon mot de passe » de la barre du haut.
 */
export default function ChangePasswordModal({
  forced = false,
  onClose,
  onSuccess,
}: Props) {
  const { user, logout } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const unmetRule = RULES.find((r) => !r.test(next));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (unmetRule) {
      setError("Le nouveau mot de passe ne respecte pas les critères.");
      return;
    }
    if (next !== confirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setSaving(true);
    try {
      await api.post("/auth/change-password", {
        currentPassword: current,
        newPassword: next,
      });
      setDone(true);
      onSuccess?.();
    } catch (err: any) {
      setError(
        err?.response?.data?.error ||
          "Erreur lors du changement de mot de passe.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={() => {
        if (!forced) onClose?.();
      }}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5 border-b border-gray-100 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-gray-900">
              {forced ? "Choisissez votre mot de passe" : "Changer mon mot de passe"}
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              {forced
                ? "Pour des raisons de sécurité, définissez votre propre mot de passe avant de continuer."
                : user?.email}
            </p>
          </div>
          {!forced && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 p-1 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              ✕
            </button>
          )}
        </div>

        {done ? (
          <div className="px-6 py-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-50 text-xl">
              ✓
            </div>
            <p className="text-sm font-medium text-gray-800">
              Mot de passe mis à jour.
            </p>
            <button
              onClick={() => onClose?.()}
              className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition"
            >
              Continuer
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
            {error && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                {error}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Mot de passe actuel
              </label>
              <input
                type="password"
                required
                autoFocus
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Nouveau mot de passe
              </label>
              <input
                type="password"
                required
                value={next}
                onChange={(e) => setNext(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Confirmer le nouveau mot de passe
              </label>
              <input
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <ul className="space-y-1">
              {RULES.map((r) => {
                const ok = r.test(next);
                return (
                  <li
                    key={r.label}
                    className={`text-xs flex items-center gap-1.5 ${
                      ok ? "text-green-600" : "text-gray-400"
                    }`}
                  >
                    <span>{ok ? "✓" : "○"}</span>
                    {r.label}
                  </li>
                );
              })}
            </ul>

            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition disabled:opacity-50"
            >
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>

            {forced && (
              <button
                type="button"
                onClick={logout}
                className="w-full text-xs text-gray-400 hover:text-gray-600 transition"
              >
                Se déconnecter
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
