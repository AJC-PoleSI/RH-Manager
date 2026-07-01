import { Router } from 'express';
import { getAllCandidates, getCandidateById, createCandidate, updateCandidate, deleteCandidate } from '../controllers/candidateController';
import { authenticateToken, requireMember, requireAdmin } from '../middlewares/authMiddleware';

const router = Router();

// Toutes les routes candidats sont réservées aux membres/jury (jamais un token
// candidat) ; les opérations destructives sont réservées aux admins.
router.use(authenticateToken, requireMember);

router.post('/', createCandidate);
router.get('/', getAllCandidates);
router.get('/:id', getCandidateById);
router.put('/:id', requireAdmin, updateCandidate);
router.delete('/:id', requireAdmin, deleteCandidate);

export default router;
