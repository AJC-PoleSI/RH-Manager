
import { Request, Response } from 'express';
import { generatePlanning } from '../services/planningService';

export const createPlanning = async (req: Request, res: Response) => {
    const { sessions, group_size } = req.body;

    try {
        const planning = await generatePlanning({
            sessions: sessions || 1,
            groupSize: group_size || 3
        });
        res.json(planning);
    } catch (error) {
        res.status(500).json({ error: 'Failed to generate planning', details: error });
    }
};

import prisma from '../utils/prisma';
import { addDays, setHours, setMinutes, startOfWeek, parse } from 'date-fns';

export const publishPlanning = async (req: Request, res: Response) => {
    const { sessions, maxCandidates } = req.body;

    if (!sessions || !Array.isArray(sessions)) {
        return res.status(400).json({ error: 'Invalid sessions data' });
    }

    // Default to next week's Monday for publication start, or current week if strictly needed.
    // Assuming "Publish" means "Make available for the upcoming cycle".
    // For simplicity, let's use the current week's Monday as base similar to the view.
    const startOfCurrentWeek = startOfWeek(new Date(), { weekStartsOn: 1 });

    try {
        const eventsToCreate = [];

        for (const session of sessions) {
            for (const group of session.groups) {
                const membersDesc = group.members.join(', ');

                for (const slotStr of group.available_slots) {
                    let date: Date;
                    let hour: number;
                    let minute: number;

                    if (slotStr.match(/^\d{4}-\d{2}-\d{2}/)) {
                        // New format: "2023-12-01 10:00"
                        const [datePart, timePart] = slotStr.split(' ');
                        [hour, minute] = timePart.split(':').map(Number);
                        date = new Date(datePart + 'T12:00:00');
                    } else {
                        // Legacy format: "Lundi 10:00"
                        const [dayName, time] = slotStr.split(' ');
                        [hour, minute] = time.split(':').map(Number);
                        const dayMap: { [key: string]: number } = { 'Lundi': 0, 'Mardi': 1, 'Mercredi': 2, 'Jeudi': 3, 'Vendredi': 4 };
                        const dayOffset = dayMap[dayName] || 0;
                        date = addDays(startOfCurrentWeek, dayOffset);
                    }

                    const startTime = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
                    const endTime = `${(hour + 1).toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

                    eventsToCreate.push({
                        title: `Session ${session.session_number} - Groupe ${group.group_id}`,
                        description: `Membres: ${membersDesc}`,
                        day: date,
                        startTime,
                        endTime,
                        maxCandidates: Number(maxCandidates) || 1
                    });
                }
            }
        }

        // Batch create using transaction or createMany
        // SQLite supports createMany in recent Prisma versions? Yes if allowed.
        // But loop create is safer for compatibility if not sure.
        // Actually prisma.calendarEvent.createMany is standard.
        await prisma.calendarEvent.createMany({
            data: eventsToCreate
        });

        res.json({ success: true, count: eventsToCreate.length });

    } catch (error) {
        console.error('Publish error:', error);
        res.status(500).json({ error: 'Failed to publish planning', details: error });
    }
};


