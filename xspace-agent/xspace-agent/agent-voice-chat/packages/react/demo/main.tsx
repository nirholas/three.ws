import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { VoiceChat, useVoiceChat, AudioVisualizer } from '@agent-voice-chat/react';

/** Demo: Drop-in VoiceChat component */
function DropInDemo() {
  return (
    <VoiceChat
      server="http://localhost:3000"
      agent="bob"
      theme="dark"
      autoConnect={false}
      onMessage={(msg) => console.log('[DropIn] message:', msg)}
      onConnect={() => console.log('[DropIn] connected')}
      onDisconnect={() => console.log('[DropIn] disconnected')}
    />
  );
}

/** Demo: Custom UI with useVoiceChat hook */
function HookDemo() {
  const {
    connect,
    disconnect,
    sendMessage,
    startListening,
    stopListening,
    isConnected,
    isListening,
    isSpeaking,
    audioLevel,
    messages,
    error,
  } = useVoiceChat({ server: 'http://localhost:3000', agent: 'bob' });

  const [text, setText] = useState('');

  return (
    <div style={{
      maxWidth: 480, padding: 20, borderRadius: 12,
      backgroundColor: '#16213e', border: '1px solid #2a2a4a',
    }}>
      <h3 style={{ marginBottom: 12 }}>Custom Hook UI</h3>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          onClick={isConnected ? disconnect : connect}
          style={{
            padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
            backgroundColor: isConnected ? '#ef4444' : '#3b82f6', color: '#fff',
          }}
        >
          {isConnected ? 'Disconnect' : 'Connect'}
        </button>
        <button
          onClick={isListening ? stopListening : startListening}
          disabled={!isConnected}
          style={{
            padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
            backgroundColor: isListening ? '#ef4444' : '#22c55e', color: '#fff',
            opacity: isConnected ? 1 : 0.4,
          }}
        >
          {isListening ? 'Stop Mic' : 'Start Mic'}
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 12, color: '#8888aa' }}>Audio:</span>
        <AudioVisualizer level={audioLevel} bars={30} height={24} color="#3b82f6" inactiveColor="#2a2a4a" />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { sendMessage(text); setText(''); } }}
          placeholder="Send a message..."
          disabled={!isConnected}
          style={{
            flex: 1, padding: '8px 12px', borderRadius: 8,
            border: '1px solid #2a2a4a', backgroundColor: '#1a1a2e',
            color: '#e0e0e0', fontSize: 14, outline: 'none',
          }}
        />
        <button
          onClick={() => { sendMessage(text); setText(''); }}
          disabled={!isConnected || !text.trim()}
          style={{
            padding: '8px 16px', borderRadius: 8, border: 'none',
            backgroundColor: '#3b82f6', color: '#fff', cursor: 'pointer',
          }}
        >
          Send
        </button>
      </div>

      <div style={{ fontSize: 12, color: '#8888aa', marginBottom: 8 }}>
        Status: {isConnected ? 'Connected' : 'Disconnected'}
        {isSpeaking && ' | Speaking'}
        {isListening && ' | Listening'}
        {error && ` | Error: ${error.message}`}
      </div>

      <div style={{ maxHeight: 200, overflowY: 'auto' }}>
        {messages.map((m) => (
          <div key={m.id} style={{
            padding: '6px 10px', marginBottom: 4, borderRadius: 6,
            backgroundColor: m.isUser ? '#1e3a5f' : '#1e293b', fontSize: 13,
          }}>
            <strong>{m.name}:</strong> {m.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function App() {
  return (
    <>
      <h1>@agent-voice-chat/react Demo</h1>
      <div className="demo-section">
        <div className="demo-grid">
          <div>
            <h2>Drop-in Component</h2>
            <DropInDemo />
          </div>
          <div>
            <h2>Custom Hook</h2>
            <HookDemo />
          </div>
        </div>
      </div>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);


