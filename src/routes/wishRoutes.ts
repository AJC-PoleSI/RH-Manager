import { Router } from 'express';
import { authenticateToken } from '../middlewares/authMiddleware';
import { getWishes, saveWishes } from '../controllers/wishController';

const router = Router();

router.get('/:candidateId', authenticateToken, getWishes);
router.put('/:candidateId', authenticateToken, saveWishes);

export default router;
