import React from 'react';
import ReactDOM from 'react-dom/client';
import OfficeCanvas from './canvas/OfficeCanvas.jsx';
import ChatOverlay from './chat/ChatOverlay.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <div style={{
      position: 'relative',
      width: '100vw',
      height: '100vh',
      background: '#1a1a2e',
      overflow: 'hidden'
    }}>
      <OfficeCanvas />
      <ChatOverlay />
    </div>
  </React.StrictMode>
);
