/**
 * Règles de pôle partagées client/serveur.
 *
 * Isolé de lib/auth.ts, qui importe jsonwebtoken et next/server : un
 * composant client ne peut pas charger ce module-là.
 */

/**
 * Compare deux libellés de pôle sans se soucier de la casse ni des accents
 * (les valeurs de members.pole sont saisies à la main).
 */
export function samePole(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const norm = (v: string | null | undefined) =>
    (v ?? "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .trim()
      .toLowerCase();
  const na = norm(a);
  return !!na && na === norm(b);
}

/** Pôle autorisé, en plus des admins, sur l'écran « Liste » des entretiens. */
export const POLE_LISTE_ENTRETIENS = "Marketing";
