import { redirect } from "next/navigation";

// Cette page a été fusionnée dans /dashboard/planning
// (gestion des épreuves + planning + publication = une seule page).
// Redirection permanente pour préserver les anciens liens/bookmarks.
export default function EpreuvesPageRedirect() {
  redirect("/dashboard/planning");
}
