/**
 * Échappement des valeurs saisies par l'utilisateur avant insertion dans un
 * email HTML. L'ordre compte : l'esperluette d'abord, sinon on ré-échappe les
 * entités que l'on vient de produire.
 */
export function escapeHtml(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
