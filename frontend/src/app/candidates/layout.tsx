import DashboardLayout from "@/components/layout/DashboardLayout";
import { CandidateSettingsProvider } from "@/context/CandidateSettingsContext";
import { CandidateStatusProvider } from "@/context/CandidateStatusContext";
import EliminationGate from "@/components/candidates/EliminationGate";

// SECURITY: only candidates can access /candidates/*. A member landing
// here will be redirected to /dashboard.
// Un candidat refusé garde son compte mais ne voit plus que son résultat
// (cf. EliminationGate).
export default function CandidateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <CandidateSettingsProvider>
      <CandidateStatusProvider>
        <DashboardLayout allowedRoles={["candidate"]}>
          <EliminationGate>{children}</EliminationGate>
        </DashboardLayout>
      </CandidateStatusProvider>
    </CandidateSettingsProvider>
  );
}
