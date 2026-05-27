"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import api from "@/lib/api";

type Status = "verifying" | "success" | "error" | "expired";

export default function VerifyEmailPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { loginCandidate } = useAuth();

  const [status, setStatus] = useState<Status>("verifying");
  const [errorMsg, setErrorMsg] = useState("");
  const [email, setEmail] = useState("");
  const [resendLoading, setResendLoading] = useState(false);
  const [resendDone, setResendDone] = useState(false);

  const verify = useCallback(async () => {
    const token = searchParams.get("token");
    if (!token) {
      setStatus("error");
      setErrorMsg("Lien invalide : aucun token trouvé.");
      return;
    }

    try {
      const res = await api.get(`/auth/verify-email?token=${token}`);
      loginCandidate(res.data.token, res.data.candidate);
      setStatus("success");
    } catch (err: any) {
      const code = err.response?.data?.code;
      const msg = err.response?.data?.error ?? "Erreur lors de la vérification.";
      if (code === "TOKEN_EXPIRED") {
        setStatus("expired");
      } else {
        setStatus("error");
      }
      setErrorMsg(msg);
    }
  }, [searchParams, loginCandidate]);

  useEffect(() => {
    verify();
  }, [verify]);

  const handleResend = async () => {
    if (!email.trim()) return;
    setResendLoading(true);
    try {
      await api.post("/auth/resend-verification", { email: email.trim() });
      setResendDone(true);
    } catch {
      /* silent */
    } finally {
      setResendLoading(false);
    }
  };

  // ─── VERIFYING ─────────────────────────────────────────────────────
  if (status === "verifying") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-pink-500" />
          <p className="text-gray-500 text-sm">Vérification en cours…</p>
        </div>
      </div>
    );
  }

  // ─── SUCCESS ────────────────────────────────────────────────────────
  if (status === "success") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-4">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">Email vérifié !</h1>
          <p className="mt-2 text-gray-500 text-sm">
            Votre compte est activé. Vous allez être redirigé vers votre espace candidat…
          </p>
          <div className="mt-4 h-1 w-full rounded-full bg-gray-100 overflow-hidden">
            <div className="h-1 rounded-full bg-green-500 animate-[grow_2s_ease-in-out_forwards]" style={{ width: "100%", animation: "none", transition: "none" }} />
          </div>
          <button
            onClick={() => router.push("/candidates/dashboard")}
            className="mt-6 inline-block rounded-lg px-6 py-2.5 text-sm font-semibold text-white"
            style={{ backgroundColor: "#E8446A" }}
          >
            Accéder à mon espace →
          </button>
        </div>
      </div>
    );
  }

  // ─── EXPIRED ────────────────────────────────────────────────────────
  if (status === "expired") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-4">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-yellow-100">
            <svg className="h-8 w-8 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">Lien expiré</h1>
          <p className="mt-2 text-gray-500 text-sm">
            Ce lien de vérification a expiré (validité 24h). Entrez votre email pour en recevoir un nouveau.
          </p>

          {!resendDone ? (
            <div className="mt-6 flex flex-col gap-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="votre@audencia.com"
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pink-400"
              />
              <button
                onClick={handleResend}
                disabled={resendLoading || !email.trim()}
                className="w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition"
                style={{ backgroundColor: "#E8446A" }}
              >
                {resendLoading ? "Envoi…" : "Renvoyer le lien"}
              </button>
            </div>
          ) : (
            <div className="mt-6 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
              Un nouveau lien a été envoyé à <strong>{email}</strong>. Consultez votre boîte mail.
            </div>
          )}

          <button
            onClick={() => router.push("/login")}
            className="mt-4 text-sm text-gray-500 hover:text-gray-700"
          >
            ← Retour à la connexion
          </button>
        </div>
      </div>
    );
  }

  // ─── ERROR ──────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-white px-4">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
          <svg className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h1 className="text-2xl font-semibold text-gray-900">Lien invalide</h1>
        <p className="mt-2 text-gray-500 text-sm">{errorMsg}</p>
        <button
          onClick={() => router.push("/login")}
          className="mt-6 inline-block rounded-lg px-6 py-2.5 text-sm font-semibold text-white"
          style={{ backgroundColor: "#E8446A" }}
        >
          Retour à la connexion
        </button>
      </div>
    </div>
  );
}
