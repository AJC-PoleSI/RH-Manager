import DashboardLayout from "@/components/layout/DashboardLayout";

// SECURITY: only members (incl. admin) can access /dashboard/*.
// A candidate landing here will be redirected to /candidates/dashboard.
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardLayout allowedRoles={["member"]}>{children}</DashboardLayout>
  );
}
