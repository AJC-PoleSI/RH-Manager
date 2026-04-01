import { Router } from 'express';
import { authenticateToken, requireAdmin } from '../middlewares/authMiddleware';
import {
    createSlot,
    updateSlot,
    deleteSlot,
    getAllSlots,
    updateSlotStatus,
    generateSlots,
    publishSlots,
    getSlotsByEpreuve,
    toggleMemberSlot,
    requestAvailability,
    getMySlots,
    getAvailableSlots,
    enrollInSlot,
    cancelEnrollment,
    getMyEnrollments,
    bulkCreateSlots,
    resetSlots
} from '../controllers/slotController';

const router = Router();

router.use(authenticateToken);

// Admin routes
router.post('/', requireAdmin, createSlot);
router.post('/bulk-create', requireAdmin, bulkCreateSlots);
router.post('/reset', requireAdmin, resetSlots);
router.put('/:id', requireAdmin, updateSlot);
router.delete('/:id', requireAdmin, deleteSlot);
router.get('/all', requireAdmin, getAllSlots);
router.put('/status/bulk', requireAdmin, updateSlotStatus);
router.post('/generate', requireAdmin, generateSlots);
router.post('/publish', requireAdmin, publishSlots);
router.get('/epreuve/:epreuveId', getSlotsByEpreuve);

// Member routes
router.post('/toggle-member', toggleMemberSlot);
router.post('/request-availability', requestAvailability);
router.get('/my-slots', getMySlots);

// Candidate routes
router.get('/available', getAvailableSlots);
router.post('/enroll', enrollInSlot);
router.delete('/enroll/:slotId', cancelEnrollment);
router.get('/my-enrollments', getMyEnrollments);

export default router;

