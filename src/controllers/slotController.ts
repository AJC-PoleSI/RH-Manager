import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middlewares/authMiddleware';
import { format } from 'date-fns';

// =============================================
// ADMIN: Create a slot on the planning grid
// =============================================
export const createSlot = async (req: Request, res: Response) => {
    const { date, startTime, endTime, durationMinutes, label, maxCandidates, minMembers, simultaneousSlots, epreuveId, tour, room } = req.body;

    if (!date || !startTime || !endTime) {
        return res.status(400).json({ error: 'date, startTime, endTime are required' });
    }

    try {
        const slot = await prisma.evaluationSlot.create({
            data: {
                date: new Date(date + 'T12:00:00'),
                startTime,
                endTime,
                durationMinutes: durationMinutes || 60,
                label: label || null,
                maxCandidates: maxCandidates || 1,
                minMembers: minMembers || 1,
                simultaneousSlots: simultaneousSlots ?? 1,
                epreuveId: epreuveId || null,
                tour: tour || 1,
                room: room || null,
                status: 'open',
            },
            include: {
                members: { include: { member: { select: { id: true, email: true } } } },
                enrollments: { include: { candidate: { select: { id: true, firstName: true, lastName: true } } } },
                requests: { include: { member: { select: { id: true, email: true } } } },
                epreuve: { select: { name: true, tour: true, type: true } },
            }
        });

        res.status(201).json(slot);
    } catch (error) {
        console.error('Create slot error:', error);
        res.status(500).json({ error: 'Failed to create slot', details: String(error) });
    }
};

// =============================================
// ADMIN: Update a slot
// =============================================
export const updateSlot = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { label, maxCandidates, minMembers, simultaneousSlots, status, room, epreuveId, startTime, endTime, durationMinutes, tour } = req.body;

    try {
        const data: any = {};
        if (label !== undefined) data.label = label;
        if (maxCandidates !== undefined) data.maxCandidates = maxCandidates;
        if (minMembers !== undefined) data.minMembers = minMembers;
        if (simultaneousSlots !== undefined) data.simultaneousSlots = simultaneousSlots;
        if (status !== undefined) data.status = status;
        if (room !== undefined) data.room = room;
        if (epreuveId !== undefined) data.epreuveId = epreuveId || null;
        if (startTime !== undefined) data.startTime = startTime;
        if (endTime !== undefined) data.endTime = endTime;
        if (durationMinutes !== undefined) data.durationMinutes = durationMinutes;
        if (tour !== undefined) data.tour = tour;

        const slot = await prisma.evaluationSlot.update({
            where: { id },
            data,
            include: {
                members: { include: { member: { select: { id: true, email: true } } } },
                enrollments: { include: { candidate: { select: { id: true, firstName: true, lastName: true } } } },
                requests: { include: { member: { select: { id: true, email: true } } } },
                epreuve: { select: { name: true, tour: true, type: true } },
            }
        });

        res.json(slot);
    } catch (error) {
        console.error('Update slot error:', error);
        res.status(500).json({ error: 'Failed to update slot' });
    }
};

// =============================================
// ADMIN: Delete a slot
// =============================================
export const deleteSlot = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        await prisma.evaluationSlot.delete({ where: { id } });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete slot' });
    }
};

// =============================================
// ADMIN: Get all slots (with filters)
// =============================================
export const getAllSlots = async (req: Request, res: Response) => {
    const { tour, status, start, end } = req.query;

    try {
        const where: any = {};
        if (tour) where.tour = parseInt(tour as string);
        if (status) where.status = status;
        if (start && end) {
            const startDate = new Date(start as string);
            startDate.setHours(0, 0, 0, 0);
            const endDate = new Date(end as string);
            endDate.setHours(23, 59, 59, 999);
            where.date = { gte: startDate, lte: endDate };
        }

        const slots = await prisma.evaluationSlot.findMany({
            where,
            include: {
                epreuve: { select: { id: true, name: true, tour: true, type: true, isGroupEpreuve: true } },
                members: { include: { member: { select: { id: true, email: true } } } },
                enrollments: {
                    include: { candidate: { select: { id: true, firstName: true, lastName: true, email: true } } },
                    orderBy: { enrolledAt: 'desc' }
                },
                requests: { include: { member: { select: { id: true, email: true } } } },
            },
            orderBy: [{ date: 'asc' }, { startTime: 'asc' }]
        });

        res.json(slots);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch slots' });
    }
};

// =============================================
// ADMIN: Bulk update slot status
// =============================================
export const updateSlotStatus = async (req: Request, res: Response) => {
    const { slotIds, status } = req.body;

    if (!slotIds || !status) {
        return res.status(400).json({ error: 'slotIds and status required' });
    }

    try {
        await prisma.evaluationSlot.updateMany({
            where: { id: { in: slotIds } },
            data: { status }
        });

        res.json({ success: true, updated: slotIds.length });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update slot status' });
    }
};

// =============================================
// ADMIN: Generate slots from availability crossing
// =============================================
export const generateSlots = async (req: Request, res: Response) => {
    const { epreuveId, startDate, endDate, membersPerSlot, maxCandidates } = req.body;

    if (!epreuveId || !startDate || !endDate) {
        return res.status(400).json({ error: 'epreuveId, startDate, endDate are required' });
    }

    try {
        const epreuve = await prisma.epreuve.findUnique({ where: { id: epreuveId } });
        if (!epreuve) return res.status(404).json({ error: 'Epreuve not found' });

        const slotDurationMinutes = epreuve.durationMinutes;
        const requiredMembers = membersPerSlot || 2;
        const candidateCapacity = maxCandidates || (epreuve.isGroupEpreuve ? epreuve.groupSize : 1);

        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        const availabilities = await prisma.availability.findMany({
            where: { date: { gte: start, lte: end } },
            include: { member: { select: { id: true, email: true } } }
        });

        const slotMap: Record<string, { members: { id: string; email: string }[], startTime: string, endTime: string, date: string }> = {};

        availabilities.forEach(av => {
            if (!av.date) return;
            const dateStr = format(new Date(av.date), 'yyyy-MM-dd');
            const key = `${dateStr}-${av.startTime}`;

            if (!slotMap[key]) {
                slotMap[key] = {
                    members: [],
                    startTime: av.startTime,
                    endTime: av.endTime,
                    date: dateStr
                };
            }

            if (!slotMap[key].members.find(m => m.id === av.member.id)) {
                slotMap[key].members.push({ id: av.member.id, email: av.member.email });
            }
        });

        const validSlots = Object.entries(slotMap)
            .filter(([_, data]) => data.members.length >= requiredMembers)
            .map(([key, data]) => ({
                key,
                date: data.date,
                startTime: data.startTime,
                endTime: data.endTime,
                availableMembers: data.members,
                memberCount: data.members.length
            }))
            .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));

        const generatedSlots = validSlots.map(slot => {
            const numberOfRooms = Math.floor(slot.availableMembers.length / requiredMembers);
            const rooms = [];

            for (let r = 0; r < numberOfRooms; r++) {
                const assignedMembers = slot.availableMembers.slice(r * requiredMembers, (r + 1) * requiredMembers);
                rooms.push({
                    roomNumber: r + 1,
                    members: assignedMembers,
                    maxCandidates: candidateCapacity
                });
            }

            return {
                date: slot.date,
                startTime: slot.startTime,
                endTime: slot.endTime,
                totalAvailableMembers: slot.memberCount,
                rooms
            };
        });

        const totalRooms = generatedSlots.reduce((sum, s) => sum + s.rooms.length, 0);
        const totalCapacity = totalRooms * candidateCapacity;

        res.json({
            epreuve: { id: epreuve.id, name: epreuve.name, tour: epreuve.tour },
            summary: {
                validTimeSlots: generatedSlots.length,
                totalRooms,
                totalCapacity,
                membersPerSlot: requiredMembers,
                candidatesPerSlot: candidateCapacity
            },
            slots: generatedSlots
        });
    } catch (error) {
        console.error('Generate slots error:', error);
        res.status(500).json({ error: 'Failed to generate slots', details: String(error) });
    }
};

// =============================================
// ADMIN: Publish generated slots to DB
// =============================================
export const publishSlots = async (req: Request, res: Response) => {
    const { epreuveId, slots } = req.body;

    if (!epreuveId || !slots || !Array.isArray(slots)) {
        return res.status(400).json({ error: 'epreuveId and slots array required' });
    }

    try {
        const epreuve = await prisma.epreuve.findUnique({ where: { id: epreuveId } });
        if (!epreuve) return res.status(404).json({ error: 'Epreuve not found' });

        const createdSlots = [];

        for (const slot of slots) {
            for (const room of slot.rooms) {
                const created = await prisma.evaluationSlot.create({
                    data: {
                        epreuveId,
                        date: new Date(slot.date + 'T12:00:00'),
                        startTime: slot.startTime,
                        endTime: slot.endTime,
                        room: room.roomLabel || `Salle ${room.roomNumber}`,
                        maxCandidates: room.maxCandidates || 1,
                        minMembers: 1,
                        status: 'open',
                        tour: epreuve.tour,
                        members: {
                            create: room.members.map((m: any) => ({
                                memberId: m.id
                            }))
                        }
                    },
                    include: {
                        members: { include: { member: { select: { email: true } } } }
                    }
                });
                createdSlots.push(created);
            }
        }

        res.json({ success: true, count: createdSlots.length, slots: createdSlots });
    } catch (error) {
        console.error('Publish slots error:', error);
        res.status(500).json({ error: 'Failed to publish slots', details: String(error) });
    }
};

// =============================================
// ADMIN: Get slots by epreuve
// =============================================
export const getSlotsByEpreuve = async (req: Request, res: Response) => {
    const { epreuveId } = req.params;

    try {
        const slots = await prisma.evaluationSlot.findMany({
            where: { epreuveId },
            include: {
                epreuve: { select: { name: true, tour: true, type: true, isGroupEpreuve: true, groupSize: true } },
                members: { include: { member: { select: { id: true, email: true } } } },
                enrollments: {
                    include: { candidate: { select: { id: true, firstName: true, lastName: true, email: true } } },
                    orderBy: { enrolledAt: 'desc' }
                }
            },
            orderBy: [{ date: 'asc' }, { startTime: 'asc' }]
        });

        res.json(slots);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch slots' });
    }
};

// =============================================
// MEMBER: Toggle availability on a slot
// =============================================
export const toggleMemberSlot = async (req: Request, res: Response) => {
    const memberId = (req as AuthRequest).user?.userId;
    if (!memberId) return res.status(401).json({ error: 'Auth required' });

    const { slotId } = req.body;
    if (!slotId) return res.status(400).json({ error: 'slotId required' });

    try {
        // Check if already assigned
        const existing = await prisma.slotMemberAssignment.findUnique({
            where: { slotId_memberId: { slotId, memberId } }
        });

        if (existing) {
            // Remove assignment
            await prisma.slotMemberAssignment.delete({ where: { id: existing.id } });

            // Check if slot needs status downgrade
            const slot = await prisma.evaluationSlot.findUnique({
                where: { id: slotId },
                include: { members: true }
            });
            if (slot && slot.status === 'ready' && slot.members.length < slot.minMembers) {
                await prisma.evaluationSlot.update({
                    where: { id: slotId },
                    data: { status: 'open' }
                });
            }

            return res.json({ action: 'removed' });
        } else {
            // Add assignment
            await prisma.slotMemberAssignment.create({
                data: { slotId, memberId }
            });

            // Check if slot reaches minMembers threshold
            const slot = await prisma.evaluationSlot.findUnique({
                where: { id: slotId },
                include: { members: true }
            });
            if (slot && slot.status === 'open' && slot.members.length >= slot.minMembers) {
                await prisma.evaluationSlot.update({
                    where: { id: slotId },
                    data: { status: 'ready' }
                });
            }

            return res.json({ action: 'added' });
        }
    } catch (error: any) {
        if (error.code === 'P2002') {
            return res.status(400).json({ error: 'Already assigned' });
        }
        console.error('Toggle member slot error:', error);
        res.status(500).json({ error: 'Failed to toggle slot assignment' });
    }
};

// =============================================
// MEMBER: Request availability on a non-opened slot time
// =============================================
export const requestAvailability = async (req: Request, res: Response) => {
    const memberId = (req as AuthRequest).user?.userId;
    if (!memberId) return res.status(401).json({ error: 'Auth required' });

    const { slotId } = req.body;
    if (!slotId) return res.status(400).json({ error: 'slotId required' });

    try {
        const existing = await prisma.slotAvailabilityRequest.findUnique({
            where: { slotId_memberId: { slotId, memberId } }
        });

        if (existing) {
            await prisma.slotAvailabilityRequest.delete({ where: { id: existing.id } });
            return res.json({ action: 'removed' });
        } else {
            await prisma.slotAvailabilityRequest.create({
                data: { slotId, memberId }
            });
            return res.json({ action: 'added' });
        }
    } catch (error: any) {
        if (error.code === 'P2002') {
            return res.status(400).json({ error: 'Already requested' });
        }
        console.error('Request availability error:', error);
        res.status(500).json({ error: 'Failed to toggle request' });
    }
};

// =============================================
// MEMBER: Get my assigned slots (planning)
// =============================================
export const getMySlots = async (req: Request, res: Response) => {
    const memberId = (req as AuthRequest).user?.userId;
    if (!memberId) return res.status(401).json({ error: 'Auth required' });

    try {
        const assignments = await prisma.slotMemberAssignment.findMany({
            where: { memberId },
            include: {
                slot: {
                    include: {
                        epreuve: { select: { name: true, tour: true, type: true } },
                        enrollments: {
                            include: {
                                candidate: { select: { id: true, firstName: true, lastName: true } }
                            }
                        },
                        members: {
                            include: { member: { select: { email: true } } }
                        }
                    }
                }
            }
        });

        const slots = assignments
            .map(a => ({
                ...a.slot,
                myAssignment: true
            }))
            .sort((a, b) => {
                const dateA = new Date(a.date).getTime();
                const dateB = new Date(b.date).getTime();
                return dateA - dateB || a.startTime.localeCompare(b.startTime);
            });

        res.json(slots);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch my slots' });
    }
};

// =============================================
// CANDIDATE: Get published/ready slots for enrollment
// =============================================
export const getAvailableSlots = async (req: Request, res: Response) => {
    const candidateId = (req as AuthRequest).user?.candidateId;

    try {
        const slots = await prisma.evaluationSlot.findMany({
            where: { status: { in: ['published', 'ready'] } },
            include: {
                epreuve: { select: { id: true, name: true, tour: true, type: true, durationMinutes: true, isGroupEpreuve: true, groupSize: true } },
                enrollments: { select: { candidateId: true } },
                members: true, // Count only
            },
            orderBy: [{ date: 'asc' }, { startTime: 'asc' }]
        });

        // Only show slots where min members is met
        const available = slots
            .filter(slot => slot.members.length >= slot.minMembers)
            .map(slot => {
                const enrolledCount = slot.enrollments.length;
                const isFull = enrolledCount >= slot.maxCandidates;
                const isEnrolled = candidateId ? slot.enrollments.some(e => e.candidateId === candidateId) : false;

                return {
                    id: slot.id,
                    epreuve: slot.epreuve,
                    date: slot.date,
                    startTime: slot.startTime,
                    endTime: slot.endTime,
                    durationMinutes: slot.durationMinutes,
                    label: slot.label,
                    tour: slot.tour,
                    maxCandidates: slot.maxCandidates,
                    enrolledCount,
                    isFull,
                    isEnrolled,
                    // Candidates do NOT see: room, members (evaluators)
                };
            });

        res.json(available);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch available slots' });
    }
};

// =============================================
// CANDIDATE: Enroll in a slot
// =============================================
export const enrollInSlot = async (req: Request, res: Response) => {
    const { slotId } = req.body;
    const candidateId = (req as AuthRequest).user?.candidateId;

    if (!candidateId) return res.status(401).json({ error: 'Candidate auth required' });
    if (!slotId) return res.status(400).json({ error: 'slotId required' });

    try {
        const slot = await prisma.evaluationSlot.findUnique({
            where: { id: slotId },
            include: { enrollments: true, epreuve: true, members: true }
        });

        if (!slot) return res.status(404).json({ error: 'Slot not found' });
        if (!['published', 'ready'].includes(slot.status)) {
            return res.status(400).json({ error: 'Ce cr\u00e9neau n\'est plus disponible' });
        }

        // Check min members met
        if (slot.members.length < slot.minMembers) {
            return res.status(400).json({ error: 'Pas assez d\'évaluateurs sur ce créneau' });
        }

        if (slot.enrollments.length >= slot.maxCandidates) {
            return res.status(400).json({ error: 'Ce cr\u00e9neau est complet' });
        }

        const existing = slot.enrollments.find(e => e.candidateId === candidateId);
        if (existing) return res.status(400).json({ error: 'Vous \u00eates d\u00e9j\u00e0 inscrit \u00e0 ce cr\u00e9neau' });

        // Check if candidate already enrolled in another slot for same epreuve
        if (slot.epreuveId) {
            const otherEnrollment = await prisma.slotEnrollment.findFirst({
                where: {
                    candidateId,
                    slot: { epreuveId: slot.epreuveId },
                    status: { not: 'cancelled' }
                }
            });
            if (otherEnrollment) {
                return res.status(400).json({ error: 'Vous \u00eates d\u00e9j\u00e0 inscrit \u00e0 un autre cr\u00e9neau pour cette \u00e9preuve' });
            }
        }

        const enrollment = await prisma.slotEnrollment.create({
            data: { slotId, candidateId },
            include: {
                slot: { include: { epreuve: { select: { name: true } } } }
            }
        });

        // Auto-update status if full
        const updatedSlot = await prisma.evaluationSlot.findUnique({
            where: { id: slotId },
            include: { enrollments: true }
        });
        if (updatedSlot && updatedSlot.enrollments.length >= updatedSlot.maxCandidates) {
            await prisma.evaluationSlot.update({
                where: { id: slotId },
                data: { status: 'full' }
            });
        }

        res.status(201).json(enrollment);
    } catch (error: any) {
        if (error.code === 'P2002') {
            return res.status(400).json({ error: 'D\u00e9j\u00e0 inscrit' });
        }
        console.error('Enroll error:', error);
        res.status(500).json({ error: 'Failed to enroll', details: String(error) });
    }
};

// =============================================
// CANDIDATE: Cancel enrollment
// =============================================
export const cancelEnrollment = async (req: Request, res: Response) => {
    const { slotId } = req.params;
    const candidateId = (req as AuthRequest).user?.candidateId;

    if (!candidateId) return res.status(401).json({ error: 'Candidate auth required' });

    try {
        const enrollment = await prisma.slotEnrollment.findFirst({
            where: { slotId, candidateId }
        });

        if (!enrollment) return res.status(404).json({ error: 'Inscription non trouv\u00e9e' });

        await prisma.slotEnrollment.delete({ where: { id: enrollment.id } });

        // If slot was full, reopen it
        const slot = await prisma.evaluationSlot.findUnique({
            where: { id: slotId },
            include: { enrollments: true, members: true }
        });
        if (slot && slot.status === 'full') {
            const newStatus = slot.members.length >= slot.minMembers ? 'ready' : 'open';
            await prisma.evaluationSlot.update({
                where: { id: slotId },
                data: { status: newStatus }
            });
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to cancel enrollment' });
    }
};

// =============================================
// CANDIDATE: Get my enrollments
// =============================================
export const getMyEnrollments = async (req: Request, res: Response) => {
    const candidateId = (req as AuthRequest).user?.candidateId;
    if (!candidateId) return res.status(401).json({ error: 'Candidate auth required' });

    try {
        const enrollments = await prisma.slotEnrollment.findMany({
            where: { candidateId },
            include: {
                slot: {
                    include: {
                        epreuve: { select: { name: true, tour: true, type: true, durationMinutes: true } }
                    }
                }
            }
        });

        const safe = enrollments.map(e => ({
            id: e.id,
            slotId: e.slotId,
            status: e.status,
            enrolledAt: e.enrolledAt,
            date: e.slot.date,
            startTime: e.slot.startTime,
            endTime: e.slot.endTime,
            room: e.slot.room,
            label: e.slot.label,
            epreuve: e.slot.epreuve
        }));

        res.json(safe);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch enrollments' });
    }
};

// =============================================
// ADMIN: Bulk create slots from a time range
// Slices a time range into individual slots
// based on epreuve duration + roulement
// =============================================
export const bulkCreateSlots = async (req: Request, res: Response) => {
    const { epreuveId, date, startTime, endTime, rooms } = req.body;

    if (!epreuveId || !date || !startTime || !endTime || !rooms || !Array.isArray(rooms)) {
        return res.status(400).json({ error: 'epreuveId, date, startTime, endTime, rooms are required' });
    }

    try {
        const epreuve = await prisma.epreuve.findUnique({ where: { id: epreuveId } }) as any;
        if (!epreuve) return res.status(404).json({ error: 'Epreuve not found' });

        const roulement = epreuve.roulementMinutes ?? epreuve.roulement_minutes ?? 10;
        const slotDuration = epreuve.durationMinutes + roulement;
        const [startH, startM] = startTime.split(':').map(Number);
        const [endH, endM] = endTime.split(':').map(Number);
        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;

        const createdSlots = [];

        for (const roomNum of rooms) {
            const roomName = `Salle ${roomNum}`;
            let current = startMinutes;

            while (current + slotDuration <= endMinutes) {
                const slotStart = `${Math.floor(current / 60).toString().padStart(2, '0')}:${(current % 60).toString().padStart(2, '0')}`;
                const slotEndMin = current + epreuve.durationMinutes;
                const slotEnd = `${Math.floor(slotEndMin / 60).toString().padStart(2, '0')}:${(slotEndMin % 60).toString().padStart(2, '0')}`;

                const slot = await prisma.evaluationSlot.create({
                    data: {
                        epreuveId,
                        date: new Date(date + 'T12:00:00'),
                        startTime: slotStart,
                        endTime: slotEnd,
                        durationMinutes: epreuve.durationMinutes,
                        room: roomName,
                        maxCandidates: epreuve.isGroupEpreuve ? epreuve.groupSize : 1,
                        minMembers: epreuve.minEvaluatorsPerSalle ?? epreuve.min_evaluators_per_salle ?? 2,
                        tour: epreuve.tour,
                        status: 'open',
                    },
                });
                createdSlots.push(slot);

                current += slotDuration;
            }
        }

        res.status(201).json({ success: true, count: createdSlots.length, slots: createdSlots });
    } catch (error) {
        console.error('Bulk create slots error:', error);
        res.status(500).json({ error: 'Failed to bulk create slots', details: String(error) });
    }
};

// =============================================
// ADMIN: Reset (delete) all slots for an epreuve
// =============================================
export const resetSlots = async (req: Request, res: Response) => {
    const { epreuveId, slotIds } = req.body;

    if (!epreuveId && (!slotIds || !Array.isArray(slotIds))) {
        return res.status(400).json({ error: 'epreuveId or slotIds required' });
    }

    try {
        let deletedCount = 0;

        if (slotIds && slotIds.length > 0) {
            // Delete by specific IDs
            for (const id of slotIds) {
                await prisma.slotMemberAssignment.deleteMany({ where: { slotId: id } });
                await prisma.slotEnrollment.deleteMany({ where: { slotId: id } });
                await prisma.slotAvailabilityRequest.deleteMany({ where: { slotId: id } });
            }
            const result = await prisma.evaluationSlot.deleteMany({ where: { id: { in: slotIds } } });
            deletedCount = result.count;
        } else if (epreuveId) {
            // Delete all slots for the epreuve
            const slots = await prisma.evaluationSlot.findMany({ where: { epreuveId }, select: { id: true } });
            const ids = slots.map(s => s.id);
            for (const id of ids) {
                await prisma.slotMemberAssignment.deleteMany({ where: { slotId: id } });
                await prisma.slotEnrollment.deleteMany({ where: { slotId: id } });
                await prisma.slotAvailabilityRequest.deleteMany({ where: { slotId: id } });
            }
            const result = await prisma.evaluationSlot.deleteMany({ where: { epreuveId } });
            deletedCount = result.count;
        }

        res.json({ success: true, deleted: deletedCount });
    } catch (error) {
        console.error('Reset slots error:', error);
        res.status(500).json({ error: 'Failed to reset slots', details: String(error) });
    }
};
