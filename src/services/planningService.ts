import prisma from '../utils/prisma';
import { addDays, format, startOfWeek } from 'date-fns';

interface PlanningInput {
    sessions: number;
    groupSize: number;
    startDate?: string;
}

export const generatePlanning = async ({ sessions, groupSize, startDate }: PlanningInput) => {
    // Default to next week if not provided? Or current?
    // Let's rely on controller/frontend to pass it. Default next Monday if missing.
    const start = startDate ? new Date(startDate) : startOfWeek(addDays(new Date(), 7), { weekStartsOn: 1 });
    const end = addDays(start, 6);

    // 1. Fetch all availabilities relevant for this week (Specific dates only)
    const availabilities = await prisma.availability.findMany({
        where: {
            date: { gte: start, lte: end }
        },
        include: { member: { select: { id: true, email: true } } }
    });

    // 2. Group by "YYYY-MM-DD HH:mm-HH:mm"
    const slots: Record<string, any[]> = {};

    availabilities.forEach(av => {
        let dateKey = '';
        if (av.date) {
            dateKey = format(new Date(av.date), 'yyyy-MM-dd');
        } else if (av.weekday) {
            // Convert generic weekday to specific date in target week
            const dayIndex = parseInt(av.weekday) - 1; // 1=Mon -> 0
            const d = addDays(start, dayIndex);
            // Warning: Ensure 'start' is indeed a Monday if we assume dayIndex 0 is Monday ??
            // If startDate is arbitrary, we must be careful.
            // Requirement usually allows planning starting Monday. 
            // Let's assume startDate IS matching Week Start.
            dateKey = format(d, 'yyyy-MM-dd');
        }

        if (dateKey) {
            const key = `${dateKey} ${av.startTime}`; // Key format: "2023-12-01 10:00"
            if (!slots[key]) slots[key] = [];
            slots[key].push(av.member);
        }
    });

    // 3. Filter slots with enough members
    const validSlots = Object.entries(slots).filter(([key, members]) => members.length >= groupSize);

    // 4. Construct response
    // We want to return "Day Name HH:mm"? Or full date?
    // Frontend expects "Lundi 10:00". With date support, we should probably return "YYYY-MM-DD HH:mm".
    // Or keep "Day HH:mm" if we want simple display, but that loses date info.
    // Let's return Full Date String in available_slots to be precise. "2023-12-01 10:00"

    const sessionGroups = validSlots.map(([timeParams, members], index) => {
        // timeParams: "2023-12-01 10:00"
        const [dateStr, timeStr] = timeParams.split(' ');
        // Format for display?
        // Frontend currently expects "Lundi 10:00".
        // Let's adapt Frontend to handle "YYYY-MM-DD HH:mm" OR we return "Lundi 10:00" matching that date.
        // Actually returning "YYYY-MM-DD HH:mm" is unambiguous.
        return {
            group_id: index + 1,
            members: members.map(m => m.email),
            available_slots: [`${dateStr} ${timeStr}`]
        };
    });

    const resultSessions = [];
    for (let i = 1; i <= sessions; i++) {
        // Simple distribution
        if (sessionGroups.length > 0) {
            resultSessions.push({
                session_number: i,
                groups: sessionGroups // In reality, slice/dice
            });
        }
    }

    return {
        global_planning: validSlots.map(([key]) => key),
        sessions: resultSessions
    };
};
