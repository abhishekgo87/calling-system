import React from 'react';
import { NavLink } from 'react-router-dom';
import { WalletBadge } from './WalletBadge';

export const Navbar: React.FC = () => {
  return (
    <header className="header">
      <div className="header-container">
        <div className="brand-section">
          <NavLink to="/" className="brand-title">
            <span>Omixo Call Test</span>
            <span className="brand-badge">Console</span>
          </NavLink>

          <nav className="nav-links" aria-label="Main Navigation">
            <NavLink
              to="/"
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              end
            >
              Place call
            </NavLink>
            <NavLink
              to="/bridge"
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              Bridge call
            </NavLink>
            <NavLink
              to="/capacity"
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              Capacity test
            </NavLink>
            <NavLink
              to="/log"
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              Call log
            </NavLink>
          </nav>
        </div>

        <div className="header-actions">
          <WalletBadge />
        </div>
      </div>
    </header>
  );
};
