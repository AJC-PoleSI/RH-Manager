export interface Member {
    id: number;
    email: string;
    firstName?: string;
    lastName?: string;
    isAdmin: boolean;
}

export interface Candidate {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
}

export interface CalendarEvent {
    id: string;
    title: string;
    description?: string;
    day: string; // ISO Date string
    startTime: string; // "HH:mm"
    endTime: string; // "HH:mm"
    relatedEpreuveId?: string;
    relatedMemberId?: number;
    relatedCandidateId?: string;
}

export interface Epreuve {
    id: string;
    name: string;
    tour: number;
    type: string;
    durationMinutes: number;
}
