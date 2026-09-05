import { describe, it, expect } from "vitest";
import { escapeHtml } from "./html";

describe("escapeHtml", () => {
  it("neutralise une balise injectée", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  it("échappe les esperluettes avant le reste", () => {
    expect(escapeHtml("Tom & <b>Jerry</b>")).toBe(
      "Tom &amp; &lt;b&gt;Jerry&lt;/b&gt;",
    );
  });

  it("échappe les guillemets, qui ferment un attribut", () => {
    expect(escapeHtml('a" onmouseover="x')).toBe("a&quot; onmouseover=&quot;x");
  });

  it("rend une chaîne vide pour une valeur absente", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});
