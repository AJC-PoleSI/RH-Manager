import { describe, it, expect } from "vitest";
import { systemMessageRow } from "./system-messages";

describe("systemMessageRow", () => {
  it("porte toujours un expéditeur — la colonne est NOT NULL en base", () => {
    const row = systemMessageRow("admin-1", {
      recipientId: "cand-1",
      recipientRole: "candidate",
      message: "Votre créneau a changé",
    });
    expect(row.sender_id).toBe("admin-1");
    expect(row.sender_id).not.toBeNull();
  });

  it("s'affiche comme « Système » côté destinataire", () => {
    const row = systemMessageRow("admin-1", {
      recipientId: "m-1",
      recipientRole: "member",
      message: "Besoin d'un remplaçant",
    });
    expect(row).toMatchObject({
      sender_role: "admin",
      sender_name: "Système",
      recipient_id: "m-1",
      recipient_role: "member",
      message: "Besoin d'un remplaçant",
    });
  });
});
