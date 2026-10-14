import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import appointmentsRouter from './routes/appointments.js';
import { getAvailability } from './services/googleCalendar.js';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
});

function lastDayOfMonth(year: number, month: number): string {
    const d = new Date(year, month + 1, 0);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
    ).padStart(2, '0')}`;
}

function firstDayOfMonth(year: number, month: number): string {
    return `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

app.get('/availability', async (req, res) => {
    try {
    const year = parseInt(String(req.query.year), 10);
    const month = parseInt(String(req.query.month), 10) - 1;

    if (isNaN(year) || isNaN(month) || month < 0 || month > 11) {
        return res.status(400).json({
        error: 'Parâmetros year e month são obrigatórios (year=YYYY, month=1-12).',
        });
    }

    const availability = await getAvailability(
        firstDayOfMonth(year, month),
        lastDayOfMonth(year, month)
    );
    return res.json(availability);
    } catch (error: any) {
        console.error('[GET /availability]', error);
        return res.status(500).json({ error: error.message || 'Erro interno no servidor.' });
    }
});

app.use('/appointments', appointmentsRouter);

export default app;