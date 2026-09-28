import type { Incident } from '../Incident';

describe('Incident model', () => {
  it('stores only minimal user references and work assignment data', () => {
    const incident: Incident = {
      id: 'INC-001',
      reporterId: 'reporter-1',
      category: 'electrical',
      description: 'No hay energía en el laboratorio',
      location: {
        source: 'manual',
        label: 'Laboratorio A',
      },
      work: {
        assignedTechnicianId: 'technician-1',
        status: 'assigned',
      },
      version: 1,
    };

    expect(incident.id).toBe('INC-001');
    expect(incident.reporterId).toBe('reporter-1');
    expect(incident.work.status).toBe('assigned');
    expect(incident.work.assignedTechnicianId).toBe('technician-1');
  });
});