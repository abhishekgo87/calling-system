import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchConfig, placeCall, fetchCall } from '../api/client';
import type { CallRecord } from '../api/types';
import { StatusBadge } from '../components/StatusBadge';

const DEFAULT_MESSAGE = 'Namaste, ye hamare CRM ka test call hai. Dhanyavaad!';
const MAX_CHARS = 800;
const MAX_POLL_DURATION_MS = 3 * 60 * 1000; // 3 minutes

export const DialPage: React.FC = () => {
  const queryClient = useQueryClient();

  const [to, setTo] = useState('');
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [inlineError, setInlineError] = useState<string | null>(null);

  // Active call tracking
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [activeCallData, setActiveCallData] = useState<CallRecord | null>(null);
  const [pollStartTime, setPollStartTime] = useState<number | null>(null);
  const [isTimedOut, setIsTimedOut] = useState(false);

  // Load allowed numbers for hint and chips
  const { data: configData } = useQuery({
    queryKey: ['config'],
    queryFn: fetchConfig,
    staleTime: 60000,
  });

  const rawAllowed = configData?.allowedNumbers || [];
  const allowedNumbers = rawAllowed.filter((n) => n !== '*');
  const allowsAll = rawAllowed.includes('*') || rawAllowed.length === 0;

  // Poll active call
  const { data: polledCall, error: pollError } = useQuery({
    queryKey: ['call', activeCallId],
    queryFn: () => fetchCall(activeCallId!),
    enabled: Boolean(activeCallId) && !isTimedOut,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 3000;
      const status = data.status.toLowerCase();
      const isTerminal = status === 'completed' || status === 'no_answer' || status === 'failed';
      if (isTerminal) {
        return false;
      }
      return 3000;
    },
  });

  // Watch polled data updates
  useEffect(() => {
    if (polledCall) {
      setActiveCallData(polledCall);

      const status = polledCall.status.toLowerCase();
      const isTerminal = status === 'completed' || status === 'no_answer' || status === 'failed';

      if (isTerminal) {
        // Refresh wallet balance when call reaches terminal status
        void queryClient.invalidateQueries({ queryKey: ['account'] });
      }
    }
  }, [polledCall, queryClient]);

  // Poll timeout watcher (3 minutes)
  useEffect(() => {
    if (!activeCallId || !pollStartTime || isTimedOut) return;

    const timer = setInterval(() => {
      const elapsed = Date.now() - pollStartTime;
      const status = activeCallData?.status?.toLowerCase();
      const isTerminal = status === 'completed' || status === 'no_answer' || status === 'failed';

      if (!isTerminal && elapsed >= MAX_POLL_DURATION_MS) {
        setIsTimedOut(true);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [activeCallId, pollStartTime, isTimedOut, activeCallData]);

  // Handle poll error
  useEffect(() => {
    if (pollError) {
      setInlineError((pollError as Error).message || 'Failed to poll call status.');
    }
  }, [pollError]);

  // Place call mutation
  const placeMutation = useMutation({
    mutationFn: () => placeCall(to.trim(), message.trim()),
    onSuccess: (newCall) => {
      setInlineError(null);
      setIsTimedOut(false);
      setActiveCallId(newCall.omixoCallId);
      setActiveCallData(newCall);
      setPollStartTime(Date.now());
    },
    onError: (err: Error) => {
      setInlineError(err.message || 'Failed to place call');
    },
  });

  const isCallActive =
    activeCallData &&
    !['completed', 'no_answer', 'failed'].includes(activeCallData.status.toLowerCase()) &&
    !isTimedOut;

  const isSubmitting = placeMutation.isPending;
  const isSubmitDisabled = isSubmitting || Boolean(isCallActive) || !to.trim() || !message.trim();

  const handlePhoneChipClick = (num: string) => {
    setTo(num);
    setInlineError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setInlineError(null);

    if (!to.trim()) {
      setInlineError('Please enter a phone number.');
      return;
    }

    if (!message.trim()) {
      setInlineError('Please enter a message to speak.');
      return;
    }

    placeMutation.mutate();
  };

  return (
    <div className="dial-page">
      <div className="panel">
        <h1 className="panel-title">Place automated OBD call</h1>
        <p className="panel-description">
          Initiate a test automated phone call through Omixo AI with spoken text-to-speech.
        </p>

        {inlineError && (
          <div className="alert alert-error" role="alert">
            {inlineError}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label htmlFor="phone-input" className="form-label">
              Phone number
            </label>
            <input
              id="phone-input"
              type="tel"
              className="form-input"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setInlineError(null);
              }}
              placeholder="e.g. 9876543210"
              disabled={isSubmitting || Boolean(isCallActive)}
              autoComplete="tel"
              required
            />

            {allowedNumbers.length > 0 && (
              <div className="chips-container" aria-label="Allowed test numbers">
                <span className="chips-label">Allowed test numbers:</span>
                {allowedNumbers.map((num) => (
                  <button
                    key={num}
                    type="button"
                    className={`chip-button ${to.includes(num) ? 'selected' : ''}`}
                    onClick={() => handlePhoneChipClick(num)}
                    disabled={isSubmitting || Boolean(isCallActive)}
                    title={`Click to fill ${num}`}
                  >
                    {num}
                  </button>
                ))}
              </div>
            )}
            <p className="form-hint">
              {allowsAll
                ? 'You can enter any 10-digit mobile number to place a call.'
                : 'Only numbers listed in ALLOWED_NUMBERS are permitted in this test environment.'}
            </p>
          </div>

          <div className="form-group">
            <label htmlFor="message-input" className="form-label">
              Message to speak
            </label>
            <textarea
              id="message-input"
              className="form-textarea"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={MAX_CHARS}
              rows={3}
              disabled={isSubmitting || Boolean(isCallActive)}
              placeholder="Enter spoken text..."
              required
            />
            <div
              className={`char-counter ${
                message.length > MAX_CHARS - 50 ? 'limit-near' : ''
              }`}
            >
              {message.length} / {MAX_CHARS} characters
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={isSubmitDisabled}
          >
            {isSubmitting
              ? 'Placing call...'
              : isCallActive
              ? 'Call in progress...'
              : 'Place call'}
          </button>
        </form>
      </div>

      {/* Active Call Status Panel */}
      {activeCallData && (
        <section
          className="active-call-panel"
          aria-live="polite"
          aria-label="Call Status Monitor"
        >
          <div className="active-call-header">
            <div>
              <h2 style={{ fontSize: '1rem', fontWeight: 600 }}>Call Status Monitor</h2>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Polling status every 3 seconds
              </span>
            </div>
            <div>
              <StatusBadge status={activeCallData.status} />
            </div>
          </div>

          <div className="active-call-grid">
            <div className="meta-item">
              <span className="meta-label">Call ID</span>
              <span className="meta-value mono-text" title={activeCallData.omixoCallId}>
                {activeCallData.omixoCallId}
              </span>
            </div>

            <div className="meta-item">
              <span className="meta-label">Recipient</span>
              <span className="meta-value mono-text">{activeCallData.to}</span>
            </div>

            <div className="meta-item">
              <span className="meta-label">Result</span>
              <span className="meta-value">
                {activeCallData.disposition || 'In progress'}
              </span>
            </div>

            <div className="meta-item">
              <span className="meta-label">Talk time</span>
              <span className="meta-value">
                {activeCallData.durationSec !== undefined
                  ? `${activeCallData.durationSec}s`
                  : '0s'}
              </span>
            </div>
          </div>

          {isTimedOut && (
            <div className="alert alert-info" style={{ marginTop: '1rem', marginBottom: 0 }}>
              Still not finished, check the Call log page.
            </div>
          )}
        </section>
      )}
    </div>
  );
};
