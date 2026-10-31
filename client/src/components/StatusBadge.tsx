import React from 'react';

interface StatusBadgeProps {
  status: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const normalized = (status || 'unknown').toLowerCase();

  return (
    <span className={`status-badge ${normalized}`} role="status">
      <span className="status-dot" aria-hidden="true" />
      <span>{normalized.replace('_', ' ')}</span>
    </span>
  );
};
