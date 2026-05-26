import DashboardLayout from "@/components/layout/DashboardLayout";
import { CandidateSettingsProvider } from "@/context/CandidateSettingsContext";

// SECURITY: only candidates can access /candidates/*. A member landing
// here will be redirected to /dashboard.
export default function CandidateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <CandidateSettingsProvider>
      <DashboardLayout allowedRoles={["candidate"]}>{children}</DashboardLayout>
    </CandidateSettingsProvider>
  );
}
