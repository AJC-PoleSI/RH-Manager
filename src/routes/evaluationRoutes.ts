import { Router } from 'express';
import { submitEvaluation, getEvaluationsByCandidate, getEvaluationsByMember, getAllEvaluatorTracking } from '../controllers/evaluationController';
import { authenticateToken, requireAdmin, requireMember } from '../middlewares/authMiddleware';

const router = Router();

// Les évaluations sont produites/consultées par les membres du jury : un token
// candidat ne doit jamais accéder à ce routeur.
router.use(authenticateToken, requireMember);

router.post('/', submitEvaluation);
router.get('/candidate/:candidateId', getEvaluationsByCandidate);
router.get('/my-evaluations', getEvaluationsByMember);
router.get('/tracking', requireAdmin, getAllEvaluatorTracking);

export default router;
