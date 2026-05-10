"use client";

import { X, RotateCcw } from "lucide-react";
import { Candidate } from "./page";

interface ActionButtonsProps {
  c: Candidate;
  size?: "sm" | "md";
  getStatus: (c: Candidate) => string;
  handleDecision: (candidateId: string, decision: string) => void;
  cancelDecision: (candidateId: string) => void;
}

export function ActionButtons({
  c,
  size = "md",
  getStatus,
  handleDecision,
  cancelDecision,
}: ActionButtonsProps) {
  const status = getStatus(c);
  const btnSize = size === "sm" ? "size-8" : "size-12";
  const iconSize = size === "sm" ? 14 : 20;

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => handleDecision(c.id, "refused")}
        className={`${btnSize} rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95`}
        style={{
          backgroundColor: status === "refused" ? "#E8446A" : "#FFF",
          border: `2px solid ${status === "refused" ? "#E8446A" : "#FCA5A5"}`,
        }}
        title="Refuser"
      >
        <X
          size={iconSize}
          color={status === "refused" ? "#FFF" : "#E8446A"}
          strokeWidth={2.5}
        />
      </button>
      <button
        onClick={() => handleDecision(c.id, "waiting")}
        className={`${btnSize} rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95`}
        style={{
          backgroundColor: status === "waiting" ? "#CA8A04" : "#FFF",
          border: `2px solid ${status === "waiting" ? "#CA8A04" : "#FDE68A"}`,
        }}
        title="Reserve"
      >
        <span
          className={`${size === "sm" ? "text-xs" : "text-sm"}`}
          style={{ filter: status === "waiting" ? "brightness(10)" : "none" }}
        >
          &#9203;
        </span>
      </button>
      {status && status !== "pending" && (
        <button
          onClick={() => cancelDecision(c.id)}
          className={`${size === "sm" ? "size-7" : "size-9"} rounded-full flex items-center justify-center transition-all hover:scale-110 bg-white border-2 border-zinc-300`}
          title="Annuler"
        >
          <RotateCcw size={size === "sm" ? 10 : 14} color="#9CA3AF" />
        </button>
      )}
      <button
        onClick={() => handleDecision(c.id, "accepted")}
        className={`${btnSize} rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95`}
        style={{
          backgroundColor: status === "accepted" ? "#16A34A" : "#FFF",
          border: `2px solid ${status === "accepted" ? "#16A34A" : "#86EFAC"}`,
        }}
        title="Accepter"
      >
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
          <path
            d="M5 13L9 17L19 7"
            stroke={status === "accepted" ? "#FFF" : "#16A34A"}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
