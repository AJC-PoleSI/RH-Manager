
import { Request, Response } from 'express';
import prisma from '../utils/prisma';

export const createEvent = async (req: Request, res: Response) => {
    try {
        const { title, description, day, day_end, dayEnd: dayEndAlt, start_time, end_time, startTime, endTime, is_global, visible_to_candidates, color, related_epreuve_id, related_member_id, related_candidate_id } = req.body;
        const isGlobal = is_global === true || is_global === 'true';
        const visibleToCandidates = visible_to_candidates !== false && visible_to_candidates !== 'false';
        const endDay = day_end || dayEndAlt || null;
        const event = await prisma.calendarEvent.create({
            data: {
                title,
                description,
                day: new Date(day),
                dayEnd: endDay ? new Date(endDay) : null,
                startTime: start_time || startTime,
                endTime: end_time || endTime,
                isGlobal,
                visibleToCandidates,
                color,
                relatedEpreuveId: related_epreuve_id,
                relatedMemberId: related_member_id,
                relatedCandidateId: related_candidate_id
            },
        });
        res.status(201).json(event);
    } catch (error) {
        console.error('Create event error:', error);
        res.status(400).json({ error: 'Failed to create event', details: String(error) });
    }
};

export const getEvents = async (req: Request, res: Response) => {
    // Can add filters by week/month here
    try {
        const { start, end } = req.query;
        const where: any = {};

        if (start && end) {
            const endDate = new Date(end as string);
            endDate.setHours(23, 59, 59, 999);
            where.day = {
                gte: new Date(start as string),
                lte: endDate
            };
        }

        const events = await prisma.calendarEvent.findMany({
            where,
            include: { epreuve: true, member: { select: { email: true } }, candidate: { select: { firstName: true, lastName: true } } }
        });
        res.json(events);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch events' });
    }
};

export const updateEvent = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const { title, description, day, day_end, dayEnd: dayEndAlt, start_time, end_time, startTime, endTime, is_global, visible_to_candidates, color, related_epreuve_id, related_member_id, related_candidate_id } = req.body;

        const data: any = {};
        if (title !== undefined) data.title = title;
        if (description !== undefined) data.description = description;
        if (day !== undefined) data.day = new Date(day);
        // Multi-day support
        const endDay = day_end !== undefined ? day_end : (dayEndAlt !== undefined ? dayEndAlt : undefined);
        if (endDay !== undefined) data.dayEnd = endDay ? new Date(endDay) : null;
        if (start_time || startTime) data.startTime = start_time || startTime;
        if (end_time || endTime) data.endTime = end_time || endTime;
        if (is_global !== undefined) data.isGlobal = is_global === true || is_global === 'true';
        if (visible_to_candidates !== undefined) data.visibleToCandidates = visible_to_candidates === true || visible_to_candidates === 'true';
        if (color !== undefined) data.color = color;
        if (related_epreuve_id !== undefined) data.relatedEpreuveId = related_epreuve_id;
        if (related_member_id !== undefined) data.relatedMemberId = related_member_id;
        if (related_candidate_id !== undefined) data.relatedCandidateId = related_candidate_id;

        const event = await prisma.calendarEvent.update({
            where: { id },
            data,
        });
        res.json(event);
    } catch (error) {
        console.error('Update event error:', error);
        res.status(400).json({ error: 'Failed to update event' });
    }
};

export const deleteEvent = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        await prisma.calendarEvent.delete({ where: { id } });
        res.status(204).send();
    } catch (error) {
        res.status(400).json({ error: 'Failed to delete event' });
    }
};
