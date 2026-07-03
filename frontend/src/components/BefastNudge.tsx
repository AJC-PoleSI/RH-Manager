"use client";

import { useState } from "react";
import api from "@/lib/api";

// Bandeau candidat RH : « Complétez votre dossier sur BeFast ».
// À monter dans le dashboard candidat, visible tant que les documents ne sont
// pas complets (prop `documentsComplete`, source : candidates.befast_documents_complete).
export default function BefastNudge({
  documentsComplete,
}: {
  documentsComplete: boolean;
}) {
  const [loading, setLoading] = useState(false);

  if (documentsComplete) return null;

  async function goToBefast() {
    setLoading(true);
    try {
      const { data } = await api.get("/sso/switch");
      if (data?.url) window.location.href = data.url;
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        background: "#FEF3C7",
        border: "1px solid #F59E0B",
        borderRadius: 10,
        padding: "12px 16px",
        margin: "12px 0",
      }}
    >
      <span style={{ fontSize: 14, color: "#92400E" }}>
        📎 Pensez à déposer vos documents sur BeFast pour compléter votre
        candidature.
      </span>
      <button
        onClick={goToBefast}
        disabled={loading}
        style={{
          whiteSpace: "nowrap",
          background: "#caa64b",
          color: "#0b1437",
          border: "none",
          borderRadius: 8,
          padding: "9px 14px",
          fontWeight: 700,
          fontSize: 13,
          cursor: "pointer",
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? "Redirection…" : "Compléter sur BeFast →"}
      </button>
    </div>
  );
}
