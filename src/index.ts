import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import appointmentsRouter from './routes/appointments.js';
import { getAvailability } from './services/googleCalendar.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

app.use(cors());
app.use(express.json());

// Rota de health check
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

// GET /availability?year=2026&month=7
// Retorna disponibilidade mensal: { "2026-07-01": ["09:00", ...], ... }
app.get('/availability', async (req, res) => {
  try {
    const year = parseInt(String(req.query.year), 10);
    const month = parseInt(String(req.query.month), 10) - 1; // mês 0-based

    if (isNaN(year) || isNaN(month) || month < 0 || month > 11) {
      return res.status(400).json({
        error: 'Parâmetros year e month são obrigatórios (year=YYYY, month=1-12).',
      });
    }

    const start = firstDayOfMonth(year, month);
    const end = lastDayOfMonth(year, month);

    const availability = await getAvailability(start, end);
    return res.json(availability);
  } catch (error: any) {
    console.error('[GET /availability]', error);
    return res.status(500).json({ error: error.message || 'Erro interno no servidor.' });
  }
});

// Rotas de agendamento (criar, listar, excluir)
app.use('/appointments', appointmentsRouter);

app.listen(PORT, () => {
  console.log(`🚀 Helena Fashion Hair API rodando em http://localhost:${PORT}`);
});