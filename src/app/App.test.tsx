import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import App from './App';

// Channel constants mirror src/backend/api-channels.ts (string enums).
const channels = {
  RendererToMainChannels: {
    SPAWN_SESSION: 'SPAWN_SESSION',
    SESSION_READY: 'SESSION_READY',
    START_MONITORING: 'START_MONITORING',
    MARK_SESSION_PROCESSED: 'MARK_SESSION_PROCESSED',
  },
  MainToRendererChannels: {
    SESSION_TRIGGERED: 'SESSION_TRIGGERED',
    SESSION_PROCESSING: 'SESSION_PROCESSING',
  },
  RequestResponseChannels: {
    SPAWN_SESSION: 'SPAWN_SESSION',
    SESSION_READY: 'SESSION_READY',
  },
};

type Handler = (data: any) => void;

interface MockApi {
  request: jest.Mock;
  send: jest.Mock;
  receive: jest.Mock;
  remove: jest.Mock;
  channels: typeof channels;
  emit: (channel: string, data: any) => void;
}

function installApi(): MockApi {
  const receivers = new Map<string, Handler>();
  const api: MockApi = {
    request: jest.fn(async () => ({ success: true, sessionId: 'session-1' })),
    send: jest.fn(),
    receive: jest.fn((channel: string, fn: Handler) => {
      receivers.set(channel, fn);
      return () => receivers.delete(channel);
    }),
    remove: jest.fn(),
    channels,
    emit: (channel: string, data: any) => receivers.get(channel)?.(data),
  };
  (window as any).api = api;
  return api;
}

describe('App', () => {
  let api: MockApi;

  beforeEach(() => {
    api = installApi();
  });

  it('renders the control panel with the ticket link input', () => {
    render(<App />);
    expect(screen.getByText(/Spawn New Session/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Ticket page link/i)).toBeInTheDocument();
    expect(screen.getByText(/Advanced settings/i)).toBeInTheDocument();
  });

  it('spawns a session with the configured url and selector', async () => {
    render(<App />);
    fireEvent.click(screen.getByText(/Spawn New Session/i));

    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith('SPAWN_SESSION', {
        url: 'https://texaslonghorns.evenue.net/signin',
        selector: '#hlLinkToQueueTicket2Text',
      }),
    );
    expect(await screen.findByText('session-1')).toBeInTheDocument();
  });

  it('sends a custom selector when the advanced field is edited', async () => {
    render(<App />);
    fireEvent.click(screen.getByText(/Advanced settings/i));
    fireEvent.change(screen.getByLabelText(/Queue element to watch/i), {
      target: { value: '#box' },
    });
    fireEvent.click(screen.getByText(/Spawn New Session/i));

    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith('SPAWN_SESSION', {
        url: 'https://texaslonghorns.evenue.net/signin',
        selector: '#box',
      }),
    );
  });

  it('moves a triggered session into the ready-to-process queue', async () => {
    render(<App />);
    fireEvent.click(screen.getByText(/Spawn New Session/i));
    await screen.findByText('session-1');

    act(() => api.emit('SESSION_TRIGGERED', { sessionId: 'session-1' }));

    expect(await screen.findByText(/Ready to Process/i)).toBeInTheDocument();
  });

  it('marks a session processed via IPC', async () => {
    render(<App />);
    fireEvent.click(screen.getByText(/Spawn New Session/i));
    await screen.findByText('session-1');
    act(() => api.emit('SESSION_TRIGGERED', { sessionId: 'session-1' }));

    fireEvent.click(await screen.findByText(/Mark Processed/i));

    expect(api.send).toHaveBeenCalledWith('MARK_SESSION_PROCESSED', { sessionId: 'session-1' });
  });
});
