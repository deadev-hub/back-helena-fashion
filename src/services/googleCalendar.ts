import { google } from 'googleapis';
import type { Appointment, CreateAppointmentInput } from '../types.js';

let calendar: any = null;

const TIME_ZONE = 'America/Sao_Paulo';

// Parse da chave da Service Account (JSON em .env)
function getServiceAccountKey(): any {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_KEY não configurado. Veja o README para instruções.'
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    return JSON.parse(raw.replace(/\\n/g, '\n'));
  }
}

function getCalendarId(): string {
  const id = process.env.GOOGLE_CALENDAR_ID;
  if (!id) {
    throw new Error(
      'GOOGLE_CALENDAR_ID não configurado. Veja o README para instruções.'
    );
  }
  return id;
}

function getConfigNumbers() {
  const workingDays = (process.env.WORKING_DAYS || '2,3,4,5,6')
    .split(',')
    .map((n) => parseInt(n.trim(), 10));
  const hourStart = parseInt(process.env.WORKING_HOURS_START || '9', 10);
  const hourEnd = parseInt(process.env.WORKING_HOURS_END || '19', 10);
  const slotDuration = parseInt(process.env.SLOT_DURATION || '60', 10);
  const blockMinutes = parseInt(process.env.BLOCK_MINUTES || '150', 10);
  return { workingDays, hourStart, hourEnd, slotDuration, blockMinutes };
}

// Inicializa o cliente da API do Google Calendar com Service Account
function init(): any {
  if (calendar) return calendar;
  const key = getServiceAccountKey();
  const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  calendar = google.calendar({ version: 'v3', auth });
  return calendar;
}

// Formata data "YYYY-MM-DD" + "HH:MM" para um start dateTime
function toDateTime(date: string, time: string): string {
  return `${date}T${time}:00`;
}

// Gera todos os slots de horário do dia conforme configuração
function generateDaySlots(date: string): string[] {
  const { hourStart, hourEnd, slotDuration } = getConfigNumbers();
  const slots: string[] = [];
  const totalMinutes = (hourEnd - hourStart) * 60;
  for (let offset = 0; offset < totalMinutes; offset += slotDuration) {
    const minutes = hourStart * 60 + offset;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
  return slots;
}

// Checa se um dia da semana é dia de funcionamento
function isWorkingDay(date: string): boolean {
  const { workingDays } = getConfigNumbers();
  const jsDay = new Date(`${date}T12:00:00`).getDay(); // 0=Dom..6=Sáb
  return workingDays.includes(jsDay);
}

// Formata data como YYYY-MM-DD local
function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface AvailabilityMap {
  [date: string]: string[];
}

function toHHMM(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function toMinutes(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

interface BlockWindow {
  date: string;
  start: number;
  end: number;
}

// Retorna as janelas bloqueadas em um período (início do evento + BLOCK_MINUTES)
async function getBlockedWindows(
  start: string,
  end: string,
  excludeId?: string
): Promise<BlockWindow[]> {
  const { blockMinutes } = getConfigNumbers();
  const cal = init();
  const res = await cal.events.list({
    calendarId: getCalendarId(),
    timeMin: new Date(start).toISOString(),
    timeMax: new Date(end).toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });

  const windows: BlockWindow[] = [];
  const events = res.data.items || [];
  for (const event of events) {
    if (excludeId && event.id === excludeId) continue;
    const startDate = event.start?.dateTime
      ? formatDate(new Date(event.start.dateTime))
      : event.start?.date;
    if (!startDate) continue;

    if (event.start?.dateTime) {
      const eventStart = new Date(event.start.dateTime);
      const blockStart = toMinutes(eventStart);
      const blockEnd = Math.min(blockStart + blockMinutes, 24 * 60);
      windows.push({ date: startDate, start: blockStart, end: blockEnd });
    } else {
      // Evento de dia inteiro: bloqueia o dia de funcionamento por completo
      windows.push({ date: startDate, start: 0, end: 24 * 60 });
    }
  }
  return windows;
}

// Retorna disponibilidade de um período (lista de datas com horários livres)
export async function getAvailability(
  startDate: string,
  endDate: string
): Promise<AvailabilityMap> {
  const { slotDuration } = getConfigNumbers();
  const blocked = await getBlockedWindows(
    `${startDate}T00:00:00`,
    `${endDate}T23:59:59`
  );
  const result: AvailabilityMap = {};

  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = formatDate(d);
    if (!isWorkingDay(dateStr)) {
      result[dateStr] = [];
      continue;
    }
    const dayBlocked = blocked.filter((w) => w.date === dateStr);
    const allSlots = generateDaySlots(dateStr);
    const free = allSlots.filter((slot) => {
      const slotStart = hhmmToMinutes(slot);
      const slotEnd = slotStart + slotDuration;
      // Bloqueia o slot se ele sobrepõe qualquer janela (evento + intervalo de segurança)
      return !dayBlocked.some((w) => slotStart < w.end && slotEnd > w.start);
    });
    result[dateStr] = free;
  }
  return result;
}

// Verifica se um horário já está ocupado por outro evento no calendário.
// Usada como validação pós-insert (defesa em profundidade contra corridas).
export async function findOverlappingEvent(
  date: string,
  startTime: string,
  endTime: string,
  excludeEventId?: string
): Promise<boolean> {
  const windows = await getBlockedWindows(
    `${date}T00:00:00`,
    `${date}T23:59:59`,
    excludeEventId
  );
  const start = hhmmToMinutes(startTime);
  const end = hhmmToMinutes(endTime);
  const dayBlocked = windows.filter((w) => w.date === date);
  return dayBlocked.some((w) => start < w.end && end > w.start);
}

// Cria um evento (agendamento) no Google Calendar
export async function createEvent(data: CreateAppointmentInput): Promise<Appointment> {
  const cal = init();
  const title = `${data.service} | ${data.clientName} | ${data.clientPhone}`;

  const res = await cal.events.insert({
    calendarId: getCalendarId(),
    requestBody: {
      summary: title,
      description:
        `Cliente: ${data.clientName}\n` +
        `Telefone: ${data.clientPhone}\n` +
        `Serviço: ${data.service}\n` +
        (data.notes ? `Observações: ${data.notes}\n` : ''),
      extendedProperties: {
        private: {
          createdBy: data.createdBy,
        },
      },
      start: {
        dateTime: toDateTime(data.date, data.startTime),
        timeZone: TIME_ZONE,
      },
      end: {
        dateTime: toDateTime(data.date, data.endTime),
        timeZone: TIME_ZONE,
      },
    },
  });

  const event = res.data;
  return {
    id: event.id as string,
    clientName: data.clientName,
    clientPhone: data.clientPhone,
    service: data.service,
    date: data.date,
    startTime: data.startTime,
    endTime: data.endTime,
    notes: data.notes,
    createdBy: data.createdBy,
  };
}

// Deleta um evento (agendamento) do Google Calendar
export async function deleteEvent(eventId: string): Promise<void> {
  const cal = init();
  await cal.events.delete({
    calendarId: getCalendarId(),
    eventId,
  });
}

// Lista todos os eventos futuros do calendário (agendamentos)
export async function listEvents(): Promise<Appointment[]> {
  const cal = init();
  const res = await cal.events.list({
    calendarId: getCalendarId(),
    timeMin: new Date().toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });

  const events = res.data.items || [];
  return events.map((event: any) => {
    const start = event.start?.dateTime
      ? new Date(event.start.dateTime)
      : new Date(`${event.start?.date}T12:00:00`);
    const end = event.end?.dateTime
      ? new Date(event.end.dateTime)
      : new Date(`${event.end?.date}T13:00:00`);
    const title = event.summary || '';

    // Título no formato: "Serviço | Nome | Telefone"
    const [service = '', clientName = '', clientPhone = ''] = (title || '')
      .split('|')
      .map((s: string) => s.trim());

    const createdBy =
      event.extendedProperties?.private?.createdBy === 'PROFESSIONAL'
        ? 'PROFESSIONAL'
        : 'CLIENT';

    return {
      id: event.id,
      clientName,
      clientPhone,
      service,
      date: formatDate(start),
      startTime: toHHMM(start),
      endTime: toHHMM(end),
      notes: event.description || undefined,
      createdBy,
    };
  });
}