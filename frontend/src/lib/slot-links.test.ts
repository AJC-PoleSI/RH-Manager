import { describe, it, expect } from "vitest";
import {
  MAX_SLOT_LINK_LABEL,
  MAX_SLOT_LINK_URL,
  normalizeSlotLinkLabel,
  normalizeSlotLinkUrl,
  slotLinkHost,
} from "./slot-links";

describe("normalizeSlotLinkUrl", () => {
  it("accepte une URL http/https telle quelle", () => {
    const res = normalizeSlotLinkUrl(
      "https://drive.google.com/file/d/abc/view",
    );
    expect(res.ok).toBe(true);
    if (res.ok)
      expect(res.url).toBe("https://drive.google.com/file/d/abc/view");
  });

  it("préfixe https:// quand l'admin colle une adresse sans schéma", () => {
    // Copier depuis la barre d'adresse de Chrome donne « docs.google.com/… » :
    // sans préfixe, le href serait relatif et mènerait à /dashboard/docs...
    const res = normalizeSlotLinkUrl("docs.google.com/document/d/xyz");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.url).toBe("https://docs.google.com/document/d/xyz");
  });

  it("ignore les espaces autour du lien", () => {
    const res = normalizeSlotLinkUrl("  https://ajc.fr/bg  ");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.url).toBe("https://ajc.fr/bg");
  });

  it("refuse javascript: et les autres schémas exécutables", () => {
    for (const bad of [
      "javascript:alert(document.cookie)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
    ]) {
      expect(normalizeSlotLinkUrl(bad), bad).toEqual({
        ok: false,
        error: "unsupported_scheme",
      });
    }
  });

  it("refuse une saisie vide ou non textuelle", () => {
    expect(normalizeSlotLinkUrl("")).toEqual({ ok: false, error: "missing" });
    expect(normalizeSlotLinkUrl("   ")).toEqual({
      ok: false,
      error: "missing",
    });
    expect(normalizeSlotLinkUrl(undefined)).toEqual({
      ok: false,
      error: "missing",
    });
    expect(normalizeSlotLinkUrl(42)).toEqual({ ok: false, error: "missing" });
  });

  it("refuse ce qui n'est pas une adresse", () => {
    expect(normalizeSlotLinkUrl("salle 204")).toEqual({
      ok: false,
      error: "not_a_url",
    });
  });

  it("refuse une URL démesurée", () => {
    const long = `https://ajc.fr/${"a".repeat(MAX_SLOT_LINK_URL)}`;
    expect(normalizeSlotLinkUrl(long)).toEqual({
      ok: false,
      error: "too_long",
    });
  });
});

describe("normalizeSlotLinkLabel", () => {
  it("rend null pour un libellé absent ou vide", () => {
    expect(normalizeSlotLinkLabel(undefined)).toBeNull();
    expect(normalizeSlotLinkLabel("")).toBeNull();
    expect(normalizeSlotLinkLabel("   ")).toBeNull();
  });

  it("nettoie et tronque", () => {
    expect(normalizeSlotLinkLabel("  Sujet du BG  ")).toBe("Sujet du BG");
    expect(normalizeSlotLinkLabel("x".repeat(200))).toHaveLength(
      MAX_SLOT_LINK_LABEL,
    );
  });
});

describe("slotLinkHost", () => {
  it("donne un hôte lisible, sans www", () => {
    expect(slotLinkHost("https://www.drive.google.com/x")).toBe(
      "drive.google.com",
    );
    expect(slotLinkHost("https://ajc.fr/bg")).toBe("ajc.fr");
  });

  it("rend null quand il n'y a rien à afficher", () => {
    expect(slotLinkHost(null)).toBeNull();
    expect(slotLinkHost("pas une url")).toBeNull();
  });
});
