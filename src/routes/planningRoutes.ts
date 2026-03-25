import { Router } from 'express';
import { createPlanning, publishPlanning } from '../controllers/planningController';
import { authenticateToken, requireAdmin } from '../middlewares/authMiddleware';

const router = Router();

router.use(authenticateToken);
router.use(requireAdmin); // Only admin can generate planning

router.post('/generate', createPlanning);
router.post('/publish', publishPlanning);

export default router;
