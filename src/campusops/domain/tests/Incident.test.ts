import { Incident } from '../Incident';

describe('Incident model', () => {
  it('creates a valid incident', () => {
    const incident: Incident = {
      id: 'INC-001',
      title: 'Falla eléctrica',
      description: 'No hay energía en el laboratorio',
      location: 'Laboratorio A',
      category: 'Electrical',
      status: 'open',
      createdAt: new Date(),
    };

    expect(incident.id).toBe('INC-001');
    expect(incident.status).toBe('open');
  });
});