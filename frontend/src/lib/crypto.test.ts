import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptData, encryptData, type EncryptedData } from "./crypto";

// Clé de test générée à la volée : jamais une vraie clé.
const KEY_HEX = crypto.randomBytes(32).toString("hex");
let previousKey: string | undefined;

beforeAll(() => {
  previousKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = KEY_HEX;
});

afterAll(() => {
  if (previousKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = previousKey;
});

function withTag(data: EncryptedData, tag: Buffer): EncryptedData {
  return { ...data, auth_tag: tag.toString("base64") };
}

describe("encryptData / decryptData (AES-256-GCM)", () => {
  it("rend le texte d'origine", () => {
    const iban = "FR76 3000 6000 0112 3456 7890 189";
    expect(decryptData(encryptData(iban))).toBe(iban);
  });

  it("produit un tag d'authentification de 16 octets", () => {
    const tag = Buffer.from(encryptData("x").auth_tag, "base64");
    expect(tag).toHaveLength(16);
  });

  it("déchiffre encore une donnée chiffrée par l'ancien code (tag par défaut, sans authTagLength)", () => {
    // Reproduction exacte de l'ancien encryptData, pour les données déjà en base.
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(KEY_HEX, "hex"), iv);
    const ciphertext = Buffer.concat([cipher.update("1 85 05 78 006 084 36", "utf-8"), cipher.final()]);
    const legacy: EncryptedData = {
      encrypted_data: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      auth_tag: cipher.getAuthTag().toString("base64"),
    };
    expect(decryptData(legacy)).toBe("1 85 05 78 006 084 36");
  });

  it.each([4, 8, 12, 15])(
    "refuse un tag tronqué à %i octets, même s'il est le début du vrai tag",
    (length) => {
      const data = encryptData("secret");
      const tag = Buffer.from(data.auth_tag, "base64");
      expect(() => decryptData(withTag(data, tag.subarray(0, length)))).toThrow(
        `${length} octets reçus, 16 attendus`,
      );
    },
  );

  it("refuse un tag trop long", () => {
    const data = encryptData("secret");
    const tag = Buffer.from(data.auth_tag, "base64");
    expect(() => decryptData(withTag(data, Buffer.concat([tag, Buffer.from([0])])))).toThrow(
      "17 octets reçus, 16 attendus",
    );
  });

  it("refuse un chiffré altéré", () => {
    const data = encryptData("secret");
    const ciphertext = Buffer.from(data.encrypted_data, "base64");
    ciphertext[0] ^= 0xff;
    expect(() =>
      decryptData({ ...data, encrypted_data: ciphertext.toString("base64") }),
    ).toThrow();
  });
});
