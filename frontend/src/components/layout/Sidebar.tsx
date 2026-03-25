"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import {
    LayoutDashboard,
    CalendarDays,
    Users,
    ScrollText,
    Award,
    Settings,
    LogOut,
    FileText,
} from 'lucide-react';

const Sidebar = () => {
    const pathname = usePathname();
    const { role, logout, user } = useAuth();

    const memberLinks = [
        { href: '/dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
        { href: '/dashboard/planning', label: 'Planning', icon: CalendarDays },
        { href: '/dashboard/candidates', label: 'Candidats', icon: Users },
        { href: '/dashboard/epreuves', label: 'Épreuves', icon: FileText },
        { href: '/dashboard/evaluations', label: 'Mes évaluations', icon: ScrollText },
        { href: '/dashboard/deliberations', label: 'Délibérations', icon: Award },
    ];

    if (user?.isAdmin) {
        memberLinks.push({ href: '/dashboard/kpis', label: 'Statistiques', icon: Award });
        memberLinks.push({ href: '/dashboard/settings', label: 'Paramètres', icon: Settings });
    }

    const candidateLinks = [
        { href: '/candidates/dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
    ];

    const links = role === 'candidate' ? candidateLinks : memberLinks;

    return (
        <aside className="w-64 bg-sidebar border-r border-gray-200 h-screen sticky top-0 flex flex-col">
            <div className="p-6 border-b border-gray-100 mb-4">
                <h1 className="text-xl font-bold text-primary-900 flex items-center gap-2">
                    <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center text-white">
                        RH
                    </div>
                    RH Manager
                </h1>
                <p className="text-xs text-gray-400 mt-1 ml-10">Junior Entreprise</p>
            </div>

            <nav className="flex-1 px-4 space-y-1">
                <p className="px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 mt-4">Navigation</p>

                {links.map((link) => {
                    const Icon = link.icon;
                    const isActive = pathname === link.href || pathname.startsWith(link.href + '/');
                    return (
                        <Link
                            key={link.href}
                            href={link.href}
                            className={cn(
                                "flex items-center gap-3 px-4 py-2.5 text-sm font-medium rounded-lg transition-colors",
                                isActive
                                    ? "bg-sidebar-active text-sidebar-activeText"
                                    : "text-sidebar-text hover:bg-sidebar-hover"
                            )}
                        >
                            <Icon size={18} />
                            {link.label}
                        </Link>
                    );
                })}
            </nav>

            <div className="p-4 border-t border-gray-100">
                <div className="flex items-center gap-3 mb-4 px-2">
                    <div className="w-10 h-10 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center font-bold">
                        {user?.email?.[0]?.toUpperCase() || user?.firstName?.[0]?.toUpperCase() || 'U'}
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                            {user?.firstName ? `${user.firstName} ${user.lastName}` : (user?.email || 'User')}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                            {role === 'member' ? (user?.isAdmin ? 'Admin' : 'Membre') : 'Candidat'}
                        </p>
                    </div>
                </div>
                <button
                    onClick={logout}
                    className="flex w-full items-center gap-3 px-4 py-2 text-sm font-medium text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                    <LogOut size={18} />
                    Déconnexion
                </button>
            </div>
        </aside>
    );
};

export default Sidebar;
