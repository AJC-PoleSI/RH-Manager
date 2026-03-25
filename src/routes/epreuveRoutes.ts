import { Router } from 'express';
import { getAllEpreuves, createEreuve, updateEpreuve, deleteEpreuve } from '../controllers/epreuveController';
import { authenticateToken, requireAdmin } from '../middlewares/authMiddleware';

const router = Router();

router.use(authenticateToken);

router.get('/', getAllEpreuves);
router.post('/', requireAdmin, createEreuve);
router.put('/:id', requireAdmin, updateEpreuve);
router.delete('/:id', requireAdmin, deleteEpreuve);

export default router;
