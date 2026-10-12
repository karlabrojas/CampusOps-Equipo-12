import { render, waitFor } from '@testing-library/react-native';

import App from '../App';

jest.mock('../src/api/courseBackend', () => ({
  getBackendHealth: jest.fn().mockResolvedValue({
    ok: true,
    service: 'dmi-controlled-backend',
    contractVersion: 1,
  }),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

test('renders the reproducible baseline and resolves backend state', async () => {
  const view = await render(<App />);
  expect(view.getByText('CampusOps')).toBeTruthy();
  await waitFor(() => expect(view.getByTestId('backend-status').props.children.join('')).toContain('available'));
});
