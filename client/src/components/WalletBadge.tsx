import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAccount } from '../api/client';

export const WalletBadge: React.FC = () => {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['account'],
    queryFn: fetchAccount,
    staleTime: 30000,
  });

  if (isLoading) {
    return (
      <div className="wallet-badge" title="Loading wallet balance...">
        <span>Wallet:</span>
        <span className="wallet-badge-value">...</span>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <button
        type="button"
        className="wallet-badge"
        onClick={() => void refetch()}
        title="Click to retry loading balance"
        style={{ cursor: 'pointer' }}
      >
        <span>Wallet:</span>
        <span className="wallet-badge-value">Unavailable</span>
      </button>
    );
  }

  const currencySymbol = data.currency === 'INR' ? '₹' : `${data.currency} `;

  return (
    <div
      className="wallet-badge"
      title={`Account: ${data.name} (${data.status})`}
    >
      <span>Wallet:</span>
      <span className="wallet-badge-value">
        {currencySymbol}
        {data.walletBalance.toFixed(2)}
      </span>
    </div>
  );
};
