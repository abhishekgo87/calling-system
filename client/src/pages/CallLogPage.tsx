import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchCalls, fetchRecords, fetchCall } from '../api/client';
import type { CallRecord, OmixoCdr } from '../api/types';
import { StatusBadge } from '../components/StatusBadge';

// Helper to normalize phone for comparison
function cleanPhone(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

// Helper to format ISO date nicely
function formatDisplayTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleString('en-IN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  } catch {
    return dateStr;
  }
}

// Row component for "From this app" tab with individual 5-second polling if non-terminal
interface MongoCallRowProps {
  initialCall: CallRecord;
  isTabOpen: boolean;
}

const MongoCallRow: React.FC<MongoCallRowProps> = ({ initialCall, isTabOpen }) => {
  const initialStatus = (initialCall.status || '').toLowerCase();
  const initiallyTerminal =
    initialStatus === 'completed' || initialStatus === 'no_answer' || initialStatus === 'failed';

  const { data: currentCall } = useQuery({
    queryKey: ['call', initialCall.omixoCallId],
    queryFn: () => fetchCall(initialCall.omixoCallId),
    initialData: initialCall,
    enabled: isTabOpen && !initiallyTerminal && initialCall.source !== 'click_to_call',
    refetchInterval: (query) => {
      const status = (query.state.data?.status || '').toLowerCase();
      const isTerminal =
        status === 'completed' || status === 'no_answer' || status === 'failed';
      return isTerminal ? false : 5000; // 5 seconds
    },
  });

  const call = currentCall || initialCall;
  const isBridge = call.source === 'click_to_call';

  return (
    <tr>
      <td style={{ whiteSpace: 'nowrap' }}>{formatDisplayTime(call.placedAt)}</td>
      <td>
        <span className={`type-badge ${isBridge ? 'bridge' : 'direct'}`}>
          {isBridge ? 'Bridge' : 'Direct'}
        </span>
      </td>
      <td className="mono-text">
        {isBridge && call.agentNumber ? `${call.agentNumber} → ${call.to}` : call.to}
      </td>
      <td className="truncated-message" title={call.message || (isBridge ? 'Two-leg bridge call' : '')}>
        {call.message || (isBridge ? <span style={{ color: 'var(--text-subtle)' }}>Two-leg bridge call</span> : '—')}
      </td>
      <td>
        <StatusBadge status={call.status} />
      </td>
      <td>
        {call.durationSec !== undefined && call.durationSec !== null ? `${call.durationSec}s` : '0s'}
      </td>
    </tr>
  );
};

export const CallLogPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'mongo' | 'omixo'>('mongo');

  // Query 1: Calls placed from this app (Mongo)
  const {
    data: mongoCalls,
    isLoading: isMongoLoading,
    isError: isMongoError,
    error: mongoError,
    refetch: refetchMongo,
  } = useQuery({
    queryKey: ['calls'],
    queryFn: () => fetchCalls(50),
    staleTime: 5000,
  });

  // Query 2: All Omixo calls live from /api/records
  const {
    data: omixoRecords,
    isLoading: isRecordsLoading,
    isError: isRecordsError,
    error: recordsError,
    isFetching: isRecordsFetching,
    refetch: refetchRecords,
  } = useQuery({
    queryKey: ['records'],
    queryFn: () => fetchRecords(50),
    staleTime: 60000,
  });

  // Match a CDR record to a Mongo call:
  // 1. Exact match: record.from === "obd:" + call.omixoCallId
  // 2. Fallback heuristic: matching 'to' phone number within 3 minutes of startedAt
  const findMatchedCall = (
    record: OmixoCdr
  ): { matchedCall: CallRecord; matchType: 'exact' | 'heuristic' } | null => {
    if (!mongoCalls || mongoCalls.length === 0) return null;

    // 1. Exact match by call id
    const exact = mongoCalls.find(
      (call) => record.from === `obd:${call.omixoCallId}` || record.from === call.omixoCallId
    );
    if (exact) {
      return { matchedCall: exact, matchType: 'exact' };
    }

    // 2. Fallback heuristic: phone number and timestamp within 3 minutes
    const recordTo = cleanPhone(record.to);
    const recordTime = new Date(record.startedAt).getTime();
    if (isNaN(recordTime)) return null;

    const heuristic = mongoCalls.find((call) => {
      // Don't match an automated OBD CDR to a bridge call
      if (record.from.startsWith('obd:') && call.source === 'click_to_call') return false;

      const callTo = cleanPhone(call.to);
      if (callTo !== recordTo) return false;

      const callTime = new Date(call.placedAt).getTime();
      if (isNaN(callTime)) return false;

      const diffMs = Math.abs(recordTime - callTime);
      return diffMs <= 3 * 60 * 1000;
    });

    if (heuristic) {
      return { matchedCall: heuristic, matchType: 'heuristic' };
    }

    return null;
  };

  return (
    <div className="call-log-page">
      <div className="panel">
        <h1 className="panel-title">Call log</h1>
        <p className="panel-description">
          Review automated calls placed from this application and real-time records from Omixo.
        </p>

        {/* Tab Selection */}
        <div className="tabs-header" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'mongo'}
            className={`tab-btn ${activeTab === 'mongo' ? 'active' : ''}`}
            onClick={() => setActiveTab('mongo')}
          >
            From this app (Mongo)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'omixo'}
            className={`tab-btn ${activeTab === 'omixo' ? 'active' : ''}`}
            onClick={() => setActiveTab('omixo')}
          >
            All Omixo calls (live)
          </button>
        </div>

        {/* Tab 1: From this app (Mongo) */}
        {activeTab === 'mongo' && (
          <div>
            {isMongoLoading ? (
              <div className="state-container">
                <p>Loading calls history...</p>
              </div>
            ) : isMongoError ? (
              <div className="state-container">
                <p className="alert alert-error">
                  {(mongoError as Error)?.message || 'Failed to load calls'}
                </p>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void refetchMongo()}
                >
                  Retry
                </button>
              </div>
            ) : !mongoCalls || mongoCalls.length === 0 ? (
              <div className="state-container">
                <p>No calls yet. Place one from the Place call page.</p>
                <Link to="/" className="btn btn-primary btn-sm">
                  Go to Place call
                </Link>
              </div>
            ) : (
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Time</th>
                      <th scope="col">Type</th>
                      <th scope="col">Number</th>
                      <th scope="col">Message</th>
                      <th scope="col">Status</th>
                      <th scope="col">Result</th>
                      <th scope="col">Talk time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mongoCalls.map((call) => (
                      <MongoCallRow
                        key={call.omixoCallId}
                        initialCall={call}
                        isTabOpen={activeTab === 'mongo'}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: All Omixo calls (live) */}
        {activeTab === 'omixo' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void refetchRecords()}
                disabled={isRecordsFetching}
              >
                {isRecordsFetching ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>

            {isRecordsLoading ? (
              <div className="state-container">
                <p>Loading call detail records from Omixo...</p>
              </div>
            ) : isRecordsError ? (
              <div className="state-container">
                <p className="alert alert-error">
                  {(recordsError as Error)?.message || 'Failed to load Omixo records'}
                </p>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void refetchRecords()}
                >
                  Retry
                </button>
              </div>
            ) : !omixoRecords || omixoRecords.length === 0 ? (
              <div className="state-container">
                <p>No Omixo call records found.</p>
              </div>
            ) : (
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Time</th>
                      <th scope="col">Direction</th>
                      <th scope="col">From</th>
                      <th scope="col">To</th>
                      <th scope="col">Talk time</th>
                      <th scope="col">Result</th>
                      <th scope="col">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {omixoRecords.map((rec) => {
                      const match = findMatchedCall(rec);
                      const tooltip =
                        match?.matchType === 'exact'
                          ? 'Matched by call id'
                          : 'Matched by number and time';

                      // If matched to a Mongo call and it has durationSec, show it with "From call status" tooltip
                      const hasStatusDuration =
                        match && match.matchedCall.durationSec !== undefined;
                      const displayDuration = hasStatusDuration
                        ? match.matchedCall.durationSec
                        : rec.durationSec;

                      return (
                        <tr key={rec.cdrId}>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {formatDisplayTime(rec.startedAt)}
                          </td>
                          <td>
                            <span
                              className={`direction-badge ${
                                rec.direction === 'inbound' ? 'in' : 'out'
                              }`}
                            >
                              {rec.direction === 'inbound' ? 'In' : 'Out'}
                            </span>
                          </td>
                          <td className="mono-text">{rec.from}</td>
                          <td className="mono-text">
                            {rec.to}
                            {match && (
                              <span
                                className="matched-tag"
                                title={tooltip}
                              >
                                placed from this app
                              </span>
                            )}
                          </td>
                          <td>
                            {hasStatusDuration ? (
                              <span title="From call status" style={{ cursor: 'help' }}>
                                {displayDuration}s
                              </span>
                            ) : (
                              <span>{displayDuration}s</span>
                            )}
                          </td>
                          <td>{rec.disposition}</td>
                          <td>₹{rec.cost.toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
