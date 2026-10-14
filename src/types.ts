export interface Appointment {
  id: string;
  clientName: string;
  clientPhone: string;
  service: string;
  date: string;
  startTime: string;
  endTime: string;
  notes?: string;
  createdBy: 'CLIENT' | 'PROFESSIONAL';
}

export interface CreateAppointmentInput {
  clientName: string;
  clientPhone: string;
  service: string;
  date: string;
  startTime: string;
  endTime: string;
  notes?: string;
  createdBy: 'CLIENT' | 'PROFESSIONAL';
}
