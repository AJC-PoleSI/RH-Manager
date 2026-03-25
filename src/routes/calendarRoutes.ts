import { Router } from 'express';
import { createEvent, getEvents, updateEvent, deleteEvent } from '../controllers/calendarController';
import { authenticateToken } from '../middlewares/authMiddleware';

const router = Router();

router.use(authenticateToken);

router.get('/', getEvents);
router.post('/', createEvent);
router.put('/:id', updateEvent);
router.delete('/:id', deleteEvent);

export default router;
