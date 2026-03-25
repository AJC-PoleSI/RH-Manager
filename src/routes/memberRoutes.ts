import { Router } from 'express';
import { getAllMembers, getMemberById, updateMember, deleteMember, createMember } from '../controllers/memberController';
import { authenticateToken, requireAdmin } from '../middlewares/authMiddleware';

const router = Router();

router.use(authenticateToken);

router.post('/', requireAdmin, createMember);
router.get('/', requireAdmin, getAllMembers); // Only admin sees all members? Or maybe all members see each other? Prompt says "Admin middleware" for "Membres". I'll assume standard users can see their own profile, but maybe listing is admin.
router.get('/:id', getMemberById);
router.put('/:id', requireAdmin, updateMember); // Admin can update others. Self-update logic optional but keeping simple.
router.delete('/:id', requireAdmin, deleteMember);

export default router;
