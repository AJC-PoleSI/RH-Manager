"use client";

import Sidebar from './Sidebar';
import Footer from './Footer';
import { useAuth } from "@/hooks/useAuth";
import { SettingsProvider } from "@/context/SettingsContext";
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

function TopNav() {
    const { user, role, logout } = useAuth();

    const displayName = user?.firstName
        ? `${user.firstName} ${user.lastName}`
        : user?.email || 'Utilisateur';

    const roleLabel = role === 'candidate'
        ? 'Candidat'
        : user?.isAdmin
            ? 'Admin'
            : 'Membre JE';

    const chipColor = role === 'candidate'
        ? 'bg-[#FFF0F3] text-[#E8446A]'
        : user?.isAdmin
            ? 'bg-blue-50 text-blue-600'
            : 'bg-blue-50 text-blue-600';

    return (
        <header className="h-14 min-h-[56px] bg-white border-b border-gray-200 sticky top-0 z-50 flex items-center justify-between px-5">
            {/* Left: Logo + role chip */}
            <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-pink-400 inline-block" />
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-400 inline-block" />
                </div>
                <span className="text-[15px] font-semibold text-gray-900 tracking-tight">
                    AJC Recrutement
                </span>
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${chipColor}`}>
                    {roleLabel}
                </span>
            </div>

            {/* Right: User name + logout */}
            <div className="flex items-center gap-4">
                <span className="text-sm text-gray-700 font-medium">
                    {displayName}
                </span>
                <button
                    onClick={logout}
                    className="text-sm text-gray-500 border border-gray-300 rounded-md px-3 py-1 hover:bg-gray-50 hover:text-gray-700 transition-colors"
                >
                    Déconnexion
                </button>
            </div>
        </header>
    );
}

function DashboardContent({ children }: { children: React.ReactNode }) {
    const { token } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (!token) {
            router.push('/login');
        }
    }, [token, router]);

    // Show loading while redirecting
    if (!token) {
        return (
            <div className="flex items-center justify-center h-screen">
                <p className="text-gray-600">Redirection...</p>
            </div>
        );
    }

    return (
        <SettingsProvider>
            <div className="flex flex-col min-h-screen">
                <TopNav />
                <div className="flex flex-1">
                    <Sidebar />
                    <div className="flex-1 flex flex-col overflow-y-auto">
                        <main className="flex-1 bg-gray-50 p-[26px_30px]">
                            {children}
                        </main>
                        <Footer />
                    </div>
                </div>
            </div>
        </SettingsProvider>
    );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <DashboardContent>{children}</DashboardContent>;
}
