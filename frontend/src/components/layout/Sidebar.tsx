"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { useState, useEffect } from 'react';

interface NavItem {
    href: string;
    label: string;
    icon: string;
}

interface NavSection {
    title: string;
    items: NavItem[];
}

const Sidebar = () => {
    const pathname = usePathname();
    const { role, user } = useAuth();
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [isMobileOpen, setIsMobileOpen] = useState(false);

    const isAdmin = role === 'member' && user?.isAdmin;
    const isCandidate = role === 'candidate';

    // Fermer le menu mobile quand on navigue
    useEffect(() => {
        setIsMobileOpen(false);
    }, [pathname]);

    const adminSections: NavSection[] = [
        {
            title: 'Navigation',
            items: [
                { href: '/dashboard', label: 'Dashboard', icon: '📊' },
                { href: '/dashboard/settings', label: 'Création', icon: '⚙️' },
                { href: '/dashboard/candidates', label: 'Candidats', icon: '👥' },
                { href: '/dashboard/evaluations', label: 'Évaluateurs', icon: '📝' },
                { href: '/dashboard/deliberations', label: 'Soirée débat', icon: '🌙' },
                { href: '/dashboard/planning', label: 'Planning', icon: '📅' },
            ],
        },
        {
            title: 'Communication',
            items: [
                { href: '/dashboard/chat', label: 'Chat général', icon: '💬' },
                { href: '/dashboard/messages', label: 'Messagerie privée', icon: '✉️' },
            ],
        },
    ];

    const memberSections: NavSection[] = [
        {
            title: 'Mon espace',
            items: [
                { href: '/dashboard/candidates', label: 'Candidats', icon: '👥' },
                { href: '/dashboard', label: 'Mon calendrier', icon: '📅' },
                { href: '/dashboard/evaluations', label: 'Mes évaluations', icon: '📊' },
                { href: '/dashboard/planning', label: 'Mes disponibilités', icon: '✅' },
            ],
        },
        {
            title: 'Communication',
            items: [
                { href: '/dashboard/chat', label: 'Chat général', icon: '💬' },
                { href: '/dashboard/messages', label: 'Messagerie privée', icon: '✉️' },
            ],
        },
    ];

    const candidateSections: NavSection[] = [
        {
            title: 'Mon parcours',
            items: [
                { href: '/candidates/dashboard', label: 'Mon calendrier', icon: '📅' },
                { href: '/candidates/epreuves', label: 'Épreuves & Tours', icon: '📋' },
                { href: '/candidates/wishes', label: 'Choix de pôle', icon: '🎯' },
            ],
        },
        {
            title: 'Communication',
            items: [
                { href: '/candidates/chat', label: 'Chat général', icon: '💬' },
                { href: '/candidates/messages', label: 'Messagerie privée', icon: '✉️' },
            ],
        },
    ];

    const sections = isCandidate
        ? candidateSections
        : isAdmin
            ? adminSections
            : memberSections;

    const isActive = (href: string) => {
        if (href === '/dashboard' || href === '/candidates/dashboard') {
            return pathname === href;
        }
        return pathname === href || pathname.startsWith(href + '/');
    };

    return (
        <>
            {/* Bouton hamburger mobile (visible uniquement sur petits écrans) */}
            <button
                onClick={() => setIsMobileOpen(true)}
                className="md:hidden fixed top-3 left-3 z-[60] bg-white border border-gray-200 rounded-lg p-2 shadow-sm"
                aria-label="Ouvrir le menu"
            >
                <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
            </button>

            {/* Overlay mobile */}
            {isMobileOpen && (
                <div
                    className="md:hidden fixed inset-0 bg-black/40 z-[70]"
                    onClick={() => setIsMobileOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside
                className={cn(
                    "bg-white border-r border-gray-200 h-full overflow-y-auto flex flex-col transition-all duration-300 ease-in-out",
                    // Desktop : collapsed = icônes seules, expanded = pleine largeur
                    isCollapsed ? "w-[68px] min-w-[68px]" : "w-[220px] min-w-[220px]",
                    // Mobile : off-canvas
                    "max-md:fixed max-md:top-0 max-md:left-0 max-md:z-[80] max-md:h-full max-md:shadow-xl",
                    isMobileOpen ? "max-md:translate-x-0 max-md:w-[260px]" : "max-md:-translate-x-full max-md:w-[260px]"
                )}
            >
                {/* Bouton toggle */}
                <div className={cn(
                    "flex items-center border-b border-gray-100 px-3 h-12 min-h-[48px]",
                    isCollapsed ? "justify-center" : "justify-between"
                )}>
                    {/* Fermer sur mobile */}
                    <button
                        onClick={() => setIsMobileOpen(false)}
                        className="md:hidden text-gray-400 hover:text-gray-600"
                        aria-label="Fermer le menu"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>

                    {/* Toggle collapse sur desktop */}
                    <button
                        onClick={() => setIsCollapsed(!isCollapsed)}
                        className="hidden md:flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors ml-auto"
                        aria-label={isCollapsed ? "Ouvrir le menu" : "Rabattre le menu"}
                        title={isCollapsed ? "Ouvrir le menu" : "Rabattre le menu"}
                    >
                        <svg
                            className={cn("w-4 h-4 transition-transform duration-300", isCollapsed && "rotate-180")}
                            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                        </svg>
                    </button>
                </div>

                {/* Navigation */}
                <nav className="px-3 py-4 flex-1">
                    {sections.map((section, idx) => (
                        <div key={section.title} className={idx > 0 ? 'mt-6' : ''}>
                            {/* Titre de section : masqué quand collapsed */}
                            <p className={cn(
                                "px-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2 transition-opacity duration-200 whitespace-nowrap overflow-hidden",
                                isCollapsed ? "opacity-0 h-0 mb-0" : "opacity-100"
                            )}>
                                {section.title}
                            </p>
                            <div className="space-y-0.5">
                                {section.items.map((item) => {
                                    const active = isActive(item.href);
                                    return (
                                        <Link
                                            key={item.href}
                                            href={item.href}
                                            title={isCollapsed ? item.label : undefined}
                                            className={cn(
                                                "flex items-center gap-3 py-2 text-sm rounded-lg transition-colors whitespace-nowrap overflow-hidden",
                                                isCollapsed ? "px-0 justify-center" : "px-3",
                                                active
                                                    ? isCandidate
                                                        ? "bg-[#FFF0F3] text-[#E8446A] font-semibold"
                                                        : "bg-blue-50 text-blue-600 font-semibold"
                                                    : "text-gray-600 hover:bg-gray-100 font-medium"
                                            )}
                                        >
                                            <span className="text-base leading-none shrink-0">{item.icon}</span>
                                            <span className={cn(
                                                "transition-opacity duration-200",
                                                isCollapsed ? "opacity-0 w-0" : "opacity-100"
                                            )}>
                                                {item.label}
                                            </span>
                                        </Link>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </nav>
            </aside>
        </>
    );
};

export default Sidebar;
