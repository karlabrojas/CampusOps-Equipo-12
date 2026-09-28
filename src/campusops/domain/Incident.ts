export type IncidentStatus =
  | 'open'
  | 'assigned'
  | 'in_progress'
  | 'resolved'
  | 'closed';

export type IncidentLocation = Readonly<{
  source: 'provider' | 'manual';
  label: string;
  latitude?: number;
  longitude?: number;
}>;

export type IncidentWork = Readonly<{
  assignedTechnicianId: string | null;
  status: IncidentStatus;
}>;

export type Incident = Readonly<{
  id: string;
  reporterId: string;
  category: string;
  description: string;
  location: IncidentLocation;
  work: IncidentWork;
  version: number;
}>;
