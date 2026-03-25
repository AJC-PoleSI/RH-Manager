import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middlewares/authMiddleware';

export const addAvailability = async (req: Request, res: Response) => {
    const memberId = (req as AuthRequest).user?.userId;
    if (!memberId) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const { weekday, start_time, end_time } = req.body;
        const availability = await prisma.availability.create({
            data: {
                memberId,
                weekday,
                startTime: start_time,
                endTime: end_time
            },
        });
        res.status(201).json(availability);
    } catch (error) {
        res.status(400).json({ error: 'Failed to add availability' });
    }
};

export const getMyAvailabilities = async (req: Request, res: Response) => {
    const memberId = (req as AuthRequest).user?.userId;
    if (!memberId) return res.status(401).json({ error: 'Unauthorized' });

    const { start, end } = req.query;

    try {
        const where: any = { memberId };

        if (start && end) {
            // Extend the date range to cover full days regardless of timezone
            const startDate = new Date(start as string);
            startDate.setHours(0, 0, 0, 0);
            const endDate = new Date(end as string);
            endDate.setHours(23, 59, 59, 999);

            where.date = {
                gte: startDate,
                lte: endDate
            };
        }

        const availabilities = await prisma.availability.findMany({ where });
        res.json(availabilities);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch availabilities' });
    }
};

// Update a single availability
export const updateAvailability = async (req: Request, res: Response) => {
    const memberId = (req as AuthRequest).user?.userId;
    const { id } = req.params;
    const { weekday, start_time, end_time, date } = req.body;

    try {
        // Verify ownership
        const existing = await prisma.availability.findUnique({ where: { id } });
        if (!existing || existing.memberId !== memberId) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const updated = await prisma.availability.update({
            where: { id },
            data: {
                weekday,
                startTime: start_time,
                endTime: end_time,
                date: date ? new Date(date) : undefined
            }
        });
        res.json(updated);
    } catch (error) {
        res.status(400).json({ error: 'Failed to update availability' });
    }
};

// Delete a single availability
export const deleteAvailability = async (req: Request, res: Response) => {
    const memberId = (req as AuthRequest).user?.userId;
    const { id } = req.params;

    try {
        // Verify ownership
        const existing = await prisma.availability.findUnique({ where: { id } });
        if (!existing || existing.memberId !== memberId) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        await prisma.availability.delete({ where: { id } });
        res.json({ message: 'Availability deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete availability' });
    }
};

// Get ALL members' availabilities for cross-calendar view (admin only)
export const getAllAvailabilities = async (req: Request, res: Response) => {
    try {
        const { start, end } = req.query;
        const where: any = {};

        if (start && end) {
            const startDate = new Date(start as string);
            startDate.setHours(0, 0, 0, 0);
            const endDate = new Date(end as string);
            endDate.setHours(23, 59, 59, 999);
            where.date = { gte: startDate, lte: endDate };
        }

        const availabilities = await prisma.availability.findMany({
            where,
            include: {
                member: { select: { id: true, email: true } }
            }
        });
        res.json(availabilities);
    } catch (error) {
        console.error('Get all availabilities error:', error);
        res.status(500).json({ error: 'Failed to fetch all availabilities' });
    }
};

export const replaceAllAvailabilities = async (req: Request, res: Response) => {
    const memberId = (req as AuthRequest).user?.userId;
    if (!memberId) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const { availabilities, startDate, endDate } = req.body;

        // If date range provided, we are in "Date Specific Mode"
        if (startDate && endDate) {
            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);

            // Transaction: Delete only in this range, then create
            await prisma.$transaction([
                prisma.availability.deleteMany({
                    where: {
                        memberId,
                        date: {
                            gte: start,
                            lte: end
                        }
                    }
                }),
                prisma.availability.createMany({
                    data: availabilities.map((a: any) => ({
                        memberId,
                        weekday: a.weekday, // Keep for ref, but date is key
                        date: new Date(a.date),
                        startTime: a.startTime,
                        endTime: a.endTime
                    }))
                })
            ]);
        } else {
            // Legacy / Generic Mode (Fallback)
            await prisma.$transaction([
                prisma.availability.deleteMany({ where: { memberId, date: null } }),
                prisma.availability.createMany({
                    data: availabilities.map((a: any) => ({
                        memberId,
                        weekday: a.weekday,
                        date: null,
                        startTime: a.startTime,
                        endTime: a.endTime
                    }))
                })
            ]);
        }

        res.json({ message: 'Availabilities updated' });
    } catch (error) {
        console.error("Replace Availabilities Error:", error);
        res.status(400).json({ error: 'Failed to replace availabilities', details: String(error) });
    }
};
