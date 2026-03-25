import { Router } from 'express';
import { getAllCandidates, getCandidateById, createCandidate, updateCandidate, deleteCandidate } from '../controllers/candidateController';
import { authenticateToken } from '../middlewares/authMiddleware';

const router = Router();

// Public routes

// Protected routes
router.use(authenticateToken);

router.post('/', createCandidate);
router.get('/', getAllCandidates);
router.get('/:id', getCandidateById);
router.put('/:id', updateCandidate);
router.delete('/:id', deleteCandidate);

export default router;
