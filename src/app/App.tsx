import React, { useEffect, useState } from 'react';
import './App.css';

// --- Type Definitions ---
type SessionStatus = 'active' | 'monitoring' | 'triggered' | 'processing' | 'processed';
interface Session {
  id: string;
  status: SessionStatus;
  url: string;
}

// --- Helper Components ---
const StatusBadge = ({ status }: { status: SessionStatus }) => {
  const colorMap: Record<SessionStatus, string> = {
    active: 'bg-blue-500',
    monitoring: 'bg-yellow-500 animate-pulse',
    triggered: 'bg-green-500 animate-bounce',
    processing: 'bg-orange-500 animate-pulse',
    processed: 'bg-gray-500',
  };
  return (
    <span className={`px-2 py-1 text-xs font-bold text-white rounded-full ${colorMap[status]}`}>
      {status.toUpperCase()}
    </span>
  );
};

const App = () => {
  // --- State Management ---
  const [url, setUrl] = useState('https://texaslonghorns.evenue.net/signin');
  const [selector, setSelector] = useState('#hlLinkToQueueTicket2Text');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [readyQueue, setReadyQueue] = useState<string[]>([]);
  const [currentActiveSession, setCurrentActiveSession] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [currentProcessingSession, setCurrentProcessingSession] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [eid, setEid] = useState('');
  const [password, setPassword] = useState('');
  const [rememberCreds, setRememberCreds] = useState(true);

  // --- Effects ---
  // Listen for triggers from the main process.
  useEffect(() => {
    if (!window.api) return;
    const cleanup = window.api.receive(window.api.channels.MainToRendererChannels.SESSION_TRIGGERED, (data) => {
      const { sessionId } = data;
      console.log(`Trigger received for session: ${sessionId}`);
      setSessions(prev =>
        prev.map(s => (s.id === sessionId ? { ...s, status: 'triggered' } : s))
      );
      setReadyQueue(prev => [...prev, sessionId]);
    });
    return cleanup;
  }, []);

  useEffect(() => {
    if (!window.api) return;
    const cleanup = window.api.receive(window.api.channels.MainToRendererChannels.SESSION_PROCESSING, (data) => {
      const { sessionId } = data;
      console.log(`Processing started for session: ${sessionId}`);
      setSessions(prev =>
        prev.map(s => (s.id === sessionId ? { ...s, status: 'processing' } : s))
      );
      setCurrentProcessingSession(sessionId);
    });
    return cleanup;
  }, []);

  // Load any saved UT login on startup (stored encrypted on this device).
  useEffect(() => {
    if (!window.api) return;
    (async () => {
      const res = await window.api.request(window.api.channels.RequestResponseChannels.LOAD_CREDENTIALS, {});
      if (res?.remembered) {
        setEid(res.eid);
        setPassword(res.password);
        setRememberCreds(true);
      }
    })();
  }, []);

  // --- Event Handlers ---
  const handleSpawnSession = async () => {
    if (currentActiveSession) {
      setError('A session is already active. Mark it as ready first.');
      return;
    }
    if (!window.api) {
      setError('App bridge failed to load — please reinstall the app.');
      return;
    }
    setIsLoading(true);
    setError(null);
    setNotice(null);
    // Persist (or clear) the saved login for next time.
    window.api.request(window.api.channels.RequestResponseChannels.SAVE_CREDENTIALS, { eid, password, remember: rememberCreds });
    const res = await window.api.request(window.api.channels.RequestResponseChannels.SPAWN_SESSION, { url, selector, eid, password });
    if (res?.success) {
      setCurrentActiveSession(res.sessionId!);
      setSessions(prev => [...prev, { id: res.sessionId!, status: 'active', url }]);
    } else {
      setError(res?.error || 'Failed to spawn session');
    }
    setIsLoading(false);
  };

  const handleSessionReady = async () => {
    if (!currentActiveSession) return;
    setIsLoading(true);
    setError(null);
    setNotice(null);
    const res = await window.api.request(window.api.channels.RequestResponseChannels.SESSION_READY, { sessionId: currentActiveSession });
    console.log('Session ready response:', res);
    if (res?.success) {
      setSessions(prev =>
        prev.map(s => (s.id === currentActiveSession ? { ...s, status: 'monitoring' } : s))
      );
      if (res.warning) setNotice(res.warning);
      setCurrentActiveSession(null);
    } else {
      setError(res?.error || 'Failed to mark session as ready');
    }
    setIsLoading(false);
  };

  const markProcessed = (sessionId: string) => {
    window.api.send(window.api.channels.RendererToMainChannels.MARK_SESSION_PROCESSED, { sessionId });
    setSessions(prev =>
      prev.map(s => (s.id === sessionId ? { ...s, status: 'processed' } : s))
    );
    setReadyQueue(prev => prev.filter(id => id !== sessionId));
    if (sessionId === currentProcessingSession) setCurrentProcessingSession(null);
  };

  // --- Render Logic ---
  return (
    <div className="bg-gray-900 text-gray-100 h-screen p-6 flex flex-col font-sans overflow-hidden">
      <header className="mb-6 shrink-0 text-center">
        <h1 className="text-3xl font-extrabold" style={{ color: '#BF5700' }}>🤘 Longhorn Ticket Grabber</h1>
        <p className="text-gray-400 text-sm mt-1">Run parallel queue sessions to boost your odds on UT&nbsp;Austin student football tickets.</p>
      </header>

      {/* --- Controls --- */}
      <div className="space-y-4 bg-gray-800 p-4 rounded-lg shadow-lg shrink-0">
        <div>
          <label htmlFor="url" className="block text-sm font-medium text-gray-300 mb-1">Ticket page link</label>
          <input type="text" id="url" value={url} onChange={e => setUrl(e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white focus:ring-indigo-500 focus:border-indigo-500" />
          <p className="text-xs text-gray-500 mt-1">Pre-filled for UT student football tickets — only change this if UT sent you a specific link.</p>
        </div>
        <div>
          <button type="button" onClick={() => setShowAdvanced(v => !v)} className="text-xs text-gray-400 hover:text-gray-200">
            {showAdvanced ? '▾ Hide advanced settings' : '▸ Advanced settings (you usually don’t need this)'}
          </button>
          {showAdvanced && (
            <div className="mt-2">
              <label htmlFor="selector" className="block text-sm font-medium text-gray-300 mb-1">Queue element to watch (CSS selector)</label>
              <input type="text" id="selector" value={selector} onChange={e => setSelector(e.target.value)} placeholder="e.g., #queue-spinner, .waiting-div" className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white focus:ring-indigo-500 focus:border-indigo-500" />
              <p className="text-xs text-gray-500 mt-1">Leave as-is unless UT changes their ticketing site. This is the waiting-room element that vanishes when you clear the queue.</p>
            </div>
          )}
        </div>
        <div className="border-t border-gray-700 pt-4">
          <label className="block text-sm font-medium text-gray-300 mb-1">Your UT login <span className="text-gray-500 font-normal">(optional — auto-fills each session)</span></label>
          <div className="flex space-x-3">
            <input type="text" value={eid} onChange={e => setEid(e.target.value)} placeholder="UT EID" autoComplete="off" className="flex-1 bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white focus:ring-indigo-500 focus:border-indigo-500" />
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" autoComplete="off" className="flex-1 bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white focus:ring-indigo-500 focus:border-indigo-500" />
          </div>
          <label className="flex items-center mt-2 text-xs text-gray-400 select-none">
            <input type="checkbox" checked={rememberCreds} onChange={e => setRememberCreds(e.target.checked)} className="mr-2" />
            Remember on this device (saved encrypted; never leaves your Mac). You still approve Duo on your phone.
          </label>
        </div>
        <div className="flex space-x-4">
          <button onClick={handleSpawnSession} disabled={isLoading || !!currentActiveSession} className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-900 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-md transition-all duration-200 shadow-md">
            {isLoading ? 'Spawning...' : '1. Spawn New Session'}
          </button>
          <button onClick={handleSessionReady} disabled={isLoading || !currentActiveSession} className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-green-900 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-md transition-all duration-200 shadow-md">
            2. Session Ready &amp; Tile
          </button>
        </div>
        {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
        {notice && <p className="text-yellow-300 text-sm mt-2">{notice}</p>}
      </div>

      {/* --- Processing Session --- */}
      {currentProcessingSession && (
        <div className="mt-6 bg-blue-900/50 border border-blue-500 p-4 rounded-lg shrink-0">
          <h2 className="text-lg font-semibold text-blue-300 mb-2">Processing Session</h2>
          <p className="text-sm">Session ID: {currentProcessingSession}</p>
          <button onClick={() => markProcessed(currentProcessingSession)} className="mt-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md transition-all duration-200 shadow-md">
            Mark as Processed
          </button>
        </div>
      )}

      {/* --- Ready Queue --- */}
      {readyQueue.length > 0 && (
        <div className="mt-6 bg-green-900/50 border border-green-500 p-4 rounded-lg shrink-0">
          <h2 className="text-lg font-semibold text-green-300 mb-2">Ready to Process</h2>
          <ul className="space-y-2">
            {readyQueue.map(id => (
              <li key={id} className="flex items-center justify-between bg-gray-800 p-2 rounded-md">
                <span className="font-mono text-sm">{id}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* --- Session List --- */}
      <div className="mt-6 flex-1 overflow-y-auto">
        <h2 className="text-xl font-semibold mb-3 text-gray-100">All Sessions ({sessions.length})</h2>
        <ul className="space-y-3">
          {[...sessions].reverse().map(session => (
            <li key={session.id} className="bg-gray-800 p-3 rounded-lg flex items-center justify-between shadow-md">
              <div className="min-w-0">
                <p className="font-mono text-indigo-300 truncate">{session.id}</p>
                <p className="text-xs text-gray-400 truncate">{session.url}</p>
              </div>
              <div className="flex items-center space-x-3 shrink-0">
                {(session.status === 'triggered' || session.status === 'processing') && (
                  <button onClick={() => markProcessed(session.id)} className="text-xs bg-blue-600 hover:bg-blue-700 text-white font-semibold py-1 px-2 rounded-md transition-all duration-200">
                    Mark Processed
                  </button>
                )}
                <StatusBadge status={session.status} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default App;
