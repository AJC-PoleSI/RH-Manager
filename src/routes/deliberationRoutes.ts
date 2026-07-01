import { Router } from 'express';
import { getAllDeliberations, getDeliberation, updateDeliberation } from '../controllers/deliberationController';
import { authenticateToken, requireMember, requireAdmin } from '../middlewares/authMiddleware';

const router = Router();

// Les délibérations (verdicts de recrutement) sont internes : réservées aux
// membres/jury en lecture, aux admins en écriture. Jamais un token candidat.
router.use(authenticateToken, requireMember);

router.get('/', getAllDeliberations);
router.get('/:candidateId', getDeliberation);
router.put('/:candidateId', requireAdmin, updateDeliberation);

export default router;
