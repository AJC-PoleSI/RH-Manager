import { Router } from 'express';
import { addAvailability, getMyAvailabilities, getAllAvailabilities, updateAvailability, deleteAvailability, replaceAllAvailabilities } from '../controllers/availabilityController';
import { authenticateToken, requireAdmin } from '../middlewares/authMiddleware';

const router = Router();

router.use(authenticateToken);

router.get('/', getMyAvailabilities);
router.get('/all', getAllAvailabilities); // Cross-calendar: all members
router.post('/', addAvailability);
router.put('/', replaceAllAvailabilities); // Bulk replace
router.put('/:id', updateAvailability);
router.delete('/:id', deleteAvailability);

export default router;
