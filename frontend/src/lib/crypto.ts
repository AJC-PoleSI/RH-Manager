import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

// Ensure encryption key is 32 bytes (256 bits)
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      "ENCRYPTION_KEY environment variable is not set. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }

  const keyBuffer = Buffer.from(key, "hex");
  if (keyBuffer.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes), got ${key.length}`
    );
  }

  return keyBuffer;
}

export interface EncryptedData {
  encrypted_data: string; // base64-encoded ciphertext
  iv: string; // base64-encoded IV
  auth_tag: string; // base64-encoded authentication tag
}

/**
 * Encrypts plaintext using AES-256-GCM
 * Returns encrypted data, IV, and authentication tag as base64 strings for database storage
 */
export function encryptData(plaintext: string): EncryptedData {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  let encrypted = cipher.update(plaintext, "utf-8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return {
    encrypted_data: Buffer.from(encrypted, "hex").toString("base64"),
    iv: iv.toString("base64"),
    auth_tag: authTag.toString("base64"),
  };
}

/**
 * Decrypts AES-256-GCM encrypted data
 * Verifies authentication tag to ensure data integrity
 *
 * La longueur du tag est imposée : sans elle, GCM accepte un tag tronqué
 * (jusqu'à 4 octets), ce qui rend la falsification d'un chiffré bien plus facile.
 * encryptData a toujours produit des tags de 16 octets (défaut de Node).
 */
export function decryptData(encrypted: EncryptedData): string {
  const key = getEncryptionKey();

  const iv = Buffer.from(encrypted.iv, "base64");
  const ciphertext = Buffer.from(encrypted.encrypted_data, "base64");
  const authTag = Buffer.from(encrypted.auth_tag, "base64");

  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error(
      `Tag d'authentification invalide : ${authTag.length} octets reçus, ${AUTH_TAG_LENGTH} attendus`
    );
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf-8");
}
