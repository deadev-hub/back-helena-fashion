import { Router } from 'express';
import {
  getAvailability,
  createEvent,
  deleteEvent,
  findOverlappingEvent,
  listEvents,
} from '../services/googleCalendar.js';
import { withCriticalSection } from '../services/lock.js';
import type { CreateAppointmentInput } from '../types.js';

const router = Router();

function parseDateParam(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Parâmetro de data inválido. Use o formato YYYY-MM-DD.');
  }
  return value;
}

// GET /appointments/available?date=2026-07-16
// Retorna apenas os horários livres de um dia específico
router.get('/available', async (_req, res) => {
  try {
    const date = parseDateParam(_req.query.date);
    const availability = await getAvailability(date, date);
    return res.json(availability[date] || []);
  } catch (error: any) {
    console.error('[GET /available]', error);
    return res.status(400).json({ error: error.message || 'Erro interno no servidor.' });
  }
});

// GET /appointments
// Lista todos os agendamentos futuros
router.get('/', async (_req, res) => {
  try {
    const events = await listEvents();
    return res.json(events);
  } catch (error: any) {
    console.error('[GET /appointments]', error);
    return res.status(500).json({ error: error.message || 'Erro interno no servidor.' });
  }
});

// POST /appointments
// Cria um novo agendamento (evento no Google Calendar)
router.post('/', async (req, res) => {
  try {
    const body: CreateAppointmentInput = req.body || {};

    if (!body.clientName || !body.clientPhone || !body.service) {
      return res.status(400).json({ error: 'Nome, telefone e serviço são obrigatórios.' });
    }
    if (!body.date || !body.startTime || !body.endTime) {
      return res.status(400).json({ error: 'Data e horários são obrigatórios.' });
    }

    if (
      body.createdBy &&
      body.createdBy !== 'CLIENT' &&
      body.createdBy !== 'PROFESSIONAL'
    ) {
      return res.status(400).json({ error: 'createdBy deve ser CLIENT ou PROFESSIONAL.' });
    }
    body.createdBy = body.createdBy || 'CLIENT';

    // Check-then-create executados de forma atômica (mutex em memória)
    const appointment = await withCriticalSection(async () => {
      // Valida se a combinação data/hora está livre antes de criar
      const availability = await getAvailability(body.date, body.date);
      const freeSlots = availability[body.date] || [];
      if (!freeSlots.includes(body.startTime)) {
        return { conflict: true };
      }

      const created = await createEvent(body);

      // Defesa em profundidade: verifica sobreposição após criar e desfaz se houver
      const overlapping = await findOverlappingEvent(
        created.date,
        created.startTime,
        created.endTime,
        created.id
      );
      if (overlapping) {
        await deleteEvent(created.id);
        return { conflict: true };
      }

      return { appointment: created };
    });

    if ('conflict' in appointment && appointment.conflict) {
      return res.status(409).json({
        error: 'Este horário acabou de ser reservado. Por favor, escolha outro.',
      });
    }

    return res.status(201).json(appointment.appointment);
  } catch (error: any) {
    console.error('[POST /appointments]', error);
    return res.status(500).json({ error: error.message || 'Erro interno no servidor.' });
  }
});

// DELETE /appointments/:id
// Remove um agendamento (deleta evento do Google Calendar)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'ID do agendamento é obrigatório.' });
    }
    await deleteEvent(id);
    return res.json({ success: true });
  } catch (error: any) {
    console.error('[DELETE /appointments/:id]', error);
    return res.status(500).json({ error: error.message || 'Erro interno no servidor.' });
  }
});

export default router;