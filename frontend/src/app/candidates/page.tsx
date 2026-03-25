import { redirect } from 'next/navigation';

export default function CandidatesRootRedirect() {
    redirect('/candidates/dashboard');
}
