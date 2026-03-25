
import { Request, Response } from 'express';
import prisma from '../utils/prisma';

export const createEvent = async (req: Request, res: Response) => {
    try {
        const { title, description, day, start_time, end_time, startTime, endTime, related_epreuve_id, related_member_id, related_candidate_id } = req.body;
        const event = await prisma.calendarEvent.create({
            data: {
                title,
                description,
                day: new Date(day),
                startTime: start_time || startTime,
                endTime: end_time || endTime,
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
        const { title, description, day, start_time, end_time, startTime, endTime, related_epreuve_id, related_member_id, related_candidate_id } = req.body;

        const data: any = {};
        if (title !== undefined) data.title = title;
        if (description !== undefined) data.description = description;
        if (day !== undefined) data.day = new Date(day);
        if (start_time || startTime) data.startTime = start_time || startTime;
        if (end_time || endTime) data.endTime = end_time || endTime;
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
