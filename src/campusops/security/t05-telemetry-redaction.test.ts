import { redactForTelemetry } from '../../course-evaluation';

describe('redactForTelemetry', () => {
  it('failure: redacts sensitive fields inside nested objects and arrays', () => {
    const input = {
      incidentId: 'campus-inc-001',
      technician_id: 'technician-1',
      metadata: {
        user_id: 'user-123',
        contact: {
          email: 'person@campusops.test',
        },
      },
      history: [
        {
          assignmentHistory: ['technician-1'],
          status: 'assigned',
        },
      ],
    };

    const result = redactForTelemetry(input);

    expect(result).toEqual({
      incidentId: 'campus-inc-001',
      technician_id: '[REDACTED]',
      metadata: {
        user_id: '[REDACTED]',
        contact: {
          email: '[REDACTED]',
        },
      },
      history: [
        {
          assignmentHistory: '[REDACTED]',
          status: 'assigned',
        },
      ],
    });
  });

  it('failure: does not mutate the original input', () => {
    const input = {
      profile: {
        email: 'person@campusops.test',
        name: 'Persona ficticia',
      },
      incidentId: 'campus-inc-001',
    };

    const original = structuredClone(input);

    redactForTelemetry(input);

    expect(input).toEqual(original);
  });

  it('boundary: preserves non-sensitive technical fields', () => {
    const input = {
      incidentId: 'campus-inc-001',
      correlationId: 'corr-001',
      status: 'assigned',
      attempt: 2,
      durationMs: 150,
    };

    expect(redactForTelemetry(input)).toEqual(input);
  });
});

