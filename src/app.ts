import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes';
import candidateRoutes from './routes/candidateRoutes';
import memberRoutes from './routes/memberRoutes';
import epreuveRoutes from './routes/epreuveRoutes';
import evaluationRoutes from './routes/evaluationRoutes';
import deliberationRoutes from './routes/deliberationRoutes';
import kpiRoutes from './routes/kpiRoutes';
import availabilityRoutes from './routes/availabilityRoutes';
import calendarRoutes from './routes/calendarRoutes';
import planningRoutes from './routes/planningRoutes';
import settingsRoutes from './routes/settingsRoutes';
import wishRoutes from './routes/wishRoutes';
import slotRoutes from './routes/slotRoutes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/candidates', candidateRoutes);
app.use('/api/members', memberRoutes);
app.use('/api/epreuves', epreuveRoutes);
app.use('/api/evaluations', evaluationRoutes);
app.use('/api/deliberations', deliberationRoutes);
app.use('/api/kpis', kpiRoutes);
app.use('/api/availability', availabilityRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/planning', planningRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/wishes', wishRoutes);
app.use('/api/slots', slotRoutes);

app.get('/', (req, res) => {
    res.send('RH Manager Backend API is running. API routes are available under /api/auth, /api/candidates, etc.');
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}

export default app;
