import { Router } from 'express';
import { submitEvaluation, getEvaluationsByCandidate, getEvaluationsByMember, getAllEvaluatorTracking } from '../controllers/evaluationController';
import { authenticateToken, requireAdmin } from '../middlewares/authMiddleware';

const router = Router();

router.use(authenticateToken);

router.post('/', submitEvaluation);
router.get('/candidate/:candidateId', getEvaluationsByCandidate);
router.get('/my-evaluations', getEvaluationsByMember);
router.get('/tracking', requireAdmin, getAllEvaluatorTracking);

export default router;
