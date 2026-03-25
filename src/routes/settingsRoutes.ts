import { Router } from 'express';
import { getSettings, updateSettings } from '../controllers/settingsController';
import { authenticateToken, requireAdmin } from '../middlewares/authMiddleware';

const router = Router();

router.get('/', authenticateToken, getSettings); // Members need read access for calendar rendering
router.put('/', authenticateToken, requireAdmin, updateSettings); // Only admins can update

export default router;
