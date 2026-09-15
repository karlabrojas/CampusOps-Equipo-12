export type IncidentStatus =
  | 'open'
  | 'assigned'
  | 'in_progress'
  | 'resolved'
  | 'closed';

export interface Incident {
  id: string;
  title: string;
  description: string;
  location: string;
  category: string;
  status: IncidentStatus;
  createdAt: Date;
}