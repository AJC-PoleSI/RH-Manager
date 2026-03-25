"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

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

    const isAdmin = role === 'member' && user?.isAdmin;
    const isCandidate = role === 'candidate';

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
        <aside className="w-[220px] min-w-[220px] bg-white border-r border-gray-200 h-full overflow-y-auto">
            <nav className="px-3 py-4">
                {sections.map((section, idx) => (
                    <div key={section.title} className={idx > 0 ? 'mt-6' : ''}>
                        <p className="px-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">
                            {section.title}
                        </p>
                        <div className="space-y-0.5">
                            {section.items.map((item) => {
                                const active = isActive(item.href);
                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        className={cn(
                                            "flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors",
                                            active
                                                ? isCandidate
                                                    ? "bg-[#FFF0F3] text-[#E8446A] font-semibold"
                                                    : "bg-blue-50 text-blue-600 font-semibold"
                                                : "text-gray-600 hover:bg-gray-100 font-medium"
                                        )}
                                    >
                                        <span className="text-base leading-none">{item.icon}</span>
                                        {item.label}
                                    </Link>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </nav>
        </aside>
    );
};

export default Sidebar;
