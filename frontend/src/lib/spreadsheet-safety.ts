/**
 * Neutralisation des formules dans les exports tableur (CSV / XLSX).
 *
 * Audit sécurité du 07/09/2026 : ni le classeur de sauvegarde (ExcelJS) ni
 * l'export candidats (SheetJS) ne traitaient les valeurs texte commençant par
 * `=`, `+`, `-` ou `@`. Or ces champs viennent de saisies libres — un candidat
 * peut s'inscrire avec le prénom `=HYPERLINK("http://attaquant.example";"Cliquez")`
 * et la formule s'exécute à l'ouverture du fichier par un membre du staff,
 * avec les droits de son poste (classe de vulnérabilité « CSV/Formula
 * Injection », OWASP).
 *
 * Convention retenue : préfixer d'une apostrophe simple, la façon standard de
 * forcer une cellule en texte dans Excel, LibreOffice et Google Sheets. La
 * valeur reste lisible, elle n'est simplement plus interprétée.
 */

/** Caractères qui déclenchent l'interprétation d'une cellule comme formule. */
const FORMULA_TRIGGERS = ["=", "+", "-", "@"];

/** Caractères de contrôle utilisés pour amorcer une injection (tab, CR, LF). */
const CONTROL_TRIGGERS = ["\t", "\r", "\n"];

/**
 * Rend une valeur sûre pour une cellule de tableur.
 * Les non-chaînes (nombres, dates, booléens, null) passent inchangées : elles
 * ne peuvent pas porter de formule.
 */
export function sanitizeSpreadsheetValue<T>(value: T): T | string {
  if (typeof value !== "string" || value.length === 0) return value;

  const first = value[0]!;
  if (FORMULA_TRIGGERS.includes(first) || CONTROL_TRIGGERS.includes(first)) {
    return `'${value}`;
  }
  return value;
}

/** Applique `sanitizeSpreadsheetValue` à toutes les valeurs d'un objet-ligne. */
export function sanitizeSpreadsheetRow<T extends Record<string, any>>(
  row: T,
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = sanitizeSpreadsheetValue(value);
  }
  return out;
}
