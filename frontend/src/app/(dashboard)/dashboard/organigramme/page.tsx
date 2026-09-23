import { redirect } from "next/navigation";

// Le trombinoscope est désormais la vue par défaut de la page Candidats
// (fusion du 23/09/2026) — cf. components/candidates/Trombinoscope.tsx.
export default function OrganigrammePage() {
  redirect("/dashboard/candidates?vue=trombinoscope");
}
