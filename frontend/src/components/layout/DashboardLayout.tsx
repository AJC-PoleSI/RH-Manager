
"use client";

import Sidebar from './Sidebar';
import { AuthProvider } from "@/hooks/useAuth";
import { SettingsProvider } from "@/context/SettingsContext";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    return (
        <AuthProvider>
            <SettingsProvider>
                <div className="flex min-h-screen bg-gray-50">
                    <Sidebar />
                    <main className="flex-1 p-8 overflow-y-auto h-screen">
                        {children}
                    </main>
                </div>
            </SettingsProvider>
        </AuthProvider>
    );
}
