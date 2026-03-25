import { Router } from 'express';
import { getGlobalKPIs } from '../controllers/kpiController';
import { authenticateToken } from '../middlewares/authMiddleware';

const router = Router();

router.use(authenticateToken);

router.get('/global', getGlobalKPIs);

export default router;
