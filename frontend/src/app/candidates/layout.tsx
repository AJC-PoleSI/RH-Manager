import DashboardLayout from '@/components/layout/DashboardLayout';
import { CandidateSettingsProvider } from '@/context/CandidateSettingsContext';

export default function CandidateLayout({ children }: { children: React.ReactNode }) {
    return (
        <CandidateSettingsProvider>
            <DashboardLayout>
                {children}
            </DashboardLayout>
        </CandidateSettingsProvider>
    );
}
