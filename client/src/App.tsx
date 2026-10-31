import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { DialPage } from './pages/DialPage';
import { BridgePage } from './pages/BridgePage';
import { CapacityPage } from './pages/CapacityPage';
import { CallLogPage } from './pages/CallLogPage';

export const App: React.FC = () => {
  return (
    <div className="app-layout">
      <Navbar />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<DialPage />} />
          <Route path="/bridge" element={<BridgePage />} />
          <Route path="/capacity" element={<CapacityPage />} />
          <Route path="/log" element={<CallLogPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
};

export default App;
