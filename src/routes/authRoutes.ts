import { Router } from 'express';
import { register, login, candidateLogin, registerCandidate } from '../controllers/authController';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/candidate-login', candidateLogin);
router.post('/register-candidate', registerCandidate);

export default router;
