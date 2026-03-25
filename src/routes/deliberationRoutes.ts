import { Router } from 'express';
import { getAllDeliberations, getDeliberation, updateDeliberation } from '../controllers/deliberationController';
import { authenticateToken } from '../middlewares/authMiddleware';

const router = Router();

router.use(authenticateToken);

router.get('/', getAllDeliberations);
router.get('/:candidateId', getDeliberation);
router.put('/:candidateId', updateDeliberation);

export default router;
