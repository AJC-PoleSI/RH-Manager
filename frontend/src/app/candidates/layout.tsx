import DashboardLayout from '@/components/layout/DashboardLayout';

export default function CandidateLayout({ children }: { children: React.ReactNode }) {
    return (
        <DashboardLayout>
            {children}
        </DashboardLayout>
    );
}
