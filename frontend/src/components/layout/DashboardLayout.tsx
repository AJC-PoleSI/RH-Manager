"use client";

import Sidebar from "./Sidebar";
import Footer from "./Footer";
import NotificationBell from "./NotificationBell";
import { useAuth } from "@/hooks/useAuth";
import { SettingsProvider } from "@/context/SettingsContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

function TopNav() {
  const { user, role, logout } = useAuth();

  const displayName = user?.firstName
    ? `${user.firstName} ${user.lastName}`
    : user?.email || "Utilisateur";

  const roleLabel =
    role === "candidate" ? "Candidat" : user?.isAdmin ? "Admin" : "Membre JE";

  const chipColor =
    role === "candidate"
      ? "bg-[#FFF0F3] text-[#E8446A]"
      : user?.isAdmin
        ? "bg-blue-50 text-blue-600"
        : "bg-blue-50 text-blue-600";

  return (
    <header className="h-14 min-h-[56px] bg-white border-b border-gray-200 sticky top-0 z-50 flex items-center justify-between pl-14 pr-3 md:px-5 gap-2">
      {/* Left: Logo + role chip */}
      <div className="flex items-center gap-2 md:gap-3 min-w-0">
        <div className="hidden sm:flex items-center gap-1.5 shrink-0">
          <span className="w-2.5 h-2.5 rounded-full bg-pink-400 inline-block" />
          <span className="w-2.5 h-2.5 rounded-full bg-blue-400 inline-block" />
        </div>
        <span className="text-[13px] md:text-[15px] font-semibold text-gray-900 tracking-tight truncate">
          AJC Recrutement
        </span>
        <span
          className={`hidden sm:inline-block text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${chipColor}`}
        >
          {roleLabel}
        </span>
      </div>

      {/* Right: Notifications + user name + logout */}
      <div className="flex items-center gap-2 md:gap-4 shrink-0">
        {role === "member" && <NotificationBell />}
        <span className="hidden md:inline text-sm text-gray-700 font-medium truncate max-w-[200px]">{displayName}</span>
        <button
          onClick={logout}
          className="text-xs md:text-sm text-gray-500 border border-gray-300 rounded-md px-2 md:px-3 py-1 hover:bg-gray-50 hover:text-gray-700 transition-colors whitespace-nowrap"
        >
          Déconnexion
        </button>
      </div>
    </header>
  );
}

function DashboardContent({
  children,
  allowedRoles,
}: {
  children: React.ReactNode;
  allowedRoles?: Array<"member" | "candidate">;
}) {
  const { token, role, isInitialized } = useAuth();
  const router = useRouter();

  // SECURITY: role-based route guard. Without this, a candidate who
  // pasted an admin URL would land on the dashboard chrome (Topnav,
  // Sidebar, even if the API blocks data fetching). Now we forcibly
  // redirect to the correct dashboard for the role.
  const roleMismatch =
    !!allowedRoles &&
    !!role &&
    !allowedRoles.includes(role);

  useEffect(() => {
    if (!isInitialized) return;
    if (!token) {
      router.replace("/login");
      return;
    }
    if (roleMismatch) {
      if (role === "candidate") {
        router.replace("/candidates/dashboard");
      } else {
        router.replace("/dashboard");
      }
    }
  }, [isInitialized, token, role, roleMismatch, router]);

  // Show loading while initializing, redirecting, or role-checking.
  if (!isInitialized || !token || roleMismatch) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-gray-600">Chargement...</p>
      </div>
    );
  }

  return (
    <SettingsProvider>
      <div className="flex flex-col min-h-screen">
        <TopNav />
        <div className="flex flex-1 relative">
          <Sidebar />
          <div className="flex-1 flex flex-col overflow-y-auto">
            <main className="flex-1 bg-gray-50 p-4 md:p-[26px_30px]">{children}</main>
            <Footer />
          </div>
        </div>
      </div>
    </SettingsProvider>
  );
}

export default function DashboardLayout({
  children,
  allowedRoles,
}: {
  children: React.ReactNode;
  allowedRoles?: Array<"member" | "candidate">;
}) {
  return (
    <DashboardContent allowedRoles={allowedRoles}>{children}</DashboardContent>
  );
}
