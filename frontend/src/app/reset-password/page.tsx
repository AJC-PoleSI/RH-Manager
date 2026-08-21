"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import api from "@/lib/api";

const RULES = [
  { test: (p: string) => p.length >= 8, label: "8 caractères minimum" },
  { test: (p: string) => /[A-Z]/.test(p), label: "au moins une majuscule" },
  { test: (p: string) => /[0-9]/.test(p), label: "au moins un chiffre" },
];

function ResetPasswordForm() {
  const params = useSearchParams();
  const router = useRouter();
  const { loginMember } = useAuth();
  const token = params?.get("token") || "";

  const [checking, setChecking] = useState(true);
  const [tokenError, setTokenError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const verify = useCallback(async () => {
    if (!token) {
      setTokenError("Lien invalide : aucun jeton fourni.");
      setChecking(false);
      return;
    }
    try {
      const res = await api.get(`/auth/reset-password?token=${token}`);
      setEmail(res.data?.email || "");
    } catch (err: any) {
      setTokenError(
        err?.response?.data?.error ||
          "Ce lien est invalide ou a expiré. Demandez-en un nouveau depuis la page de connexion.",
      );
    } finally {
      setChecking(false);
    }
  }, [token]);

  useEffect(() => {
    verify();
  }, [verify]);

  const unmetRule = RULES.find((r) => !r.test(password));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (unmetRule) {
      setError("Le mot de passe ne respecte pas les critères ci-dessous.");
      return;
    }
    if (password !== confirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post("/auth/reset-password", { token, password });
      // Le serveur renvoie un JWT : on enchaîne directement sur le dashboard.
      loginMember(res.data.token, res.data.member);
    } catch (err: any) {
      setError(
        err?.response?.data?.error ||
          "Erreur lors de la réinitialisation du mot de passe.",
      );
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <p className="text-gray-500 text-sm">Vérification du lien…</p>
      </div>
    );
  }

  if (tokenError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-[440px] bg-white rounded-xl shadow-lg p-8 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-2xl">
            ⚠️
          </div>
          <h1 className="text-lg font-semibold text-gray-900">
            Lien inutilisable
          </h1>
          <p className="mt-2 text-sm text-gray-500 leading-relaxed">
            {tokenError}
          </p>
          <button
            onClick={() => router.push("/login")}
            className="mt-6 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition"
          >
            Retour à la connexion
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-[440px] bg-white rounded-xl shadow-lg p-6 sm:p-8">
        <h1 className="text-xl font-semibold text-gray-900 text-center">
          Choisissez votre mot de passe
        </h1>
        {email && (
          <p className="mt-1 text-sm text-gray-500 text-center">
            Pour le compte <strong className="text-gray-700">{email}</strong>
          </p>
        )}

        {error && (
          <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nouveau mot de passe
            </label>
            <input
              type="password"
              required
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Confirmer le mot de passe
            </label>
            <input
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <ul className="space-y-1">
            {RULES.map((r) => {
              const ok = r.test(password);
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
            disabled={submitting}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition disabled:opacity-50"
          >
            {submitting ? "Enregistrement…" : "Enregistrer et me connecter"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <p className="text-gray-500 text-sm">Chargement…</p>
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
