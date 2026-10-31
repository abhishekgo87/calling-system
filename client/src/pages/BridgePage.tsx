import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchConfig, startBridgeCall, hangupBridgeCall, fetchBridgeResult } from '../api/client';
import type { CallRecord, OmixoCdr } from '../api/types';
import { StatusBadge } from '../components/StatusBadge';

const MAX_POLL_DURATION_MS = 4 * 60 * 1000; // 4 minutes

export const BridgePage: React.FC = () => {
  const queryClient = useQueryClient();

  const [agent, setAgent] = useState('');
  const [customer, setCustomer] = useState('');
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [noPlanError, setNoPlanError] = useState<string | null>(null);

  // Active bridge call state
  const [activeCall, setActiveCall] = useState<CallRecord | null>(null);
  const [bridgeResult, setBridgeResult] = useState<OmixoCdr | null>(null);
  const [pollStartTime, setPollStartTime] = useState<number | null>(null);
  const [isTimedOut, setIsTimedOut] = useState(false);
  const [isHungUpByMe, setIsHungUpByMe] = useState(false);

  // Load allowed numbers for chips
  const { data: configData } = useQuery({
    queryKey: ['config'],
    queryFn: fetchConfig,
    staleTime: 60000,
  });

  const rawAllowed = configData?.allowedNumbers || [];
  const allowedNumbers = rawAllowed.filter((n) => n !== '*');
  const allowsAll = rawAllowed.includes('*') || rawAllowed.length === 0;

  // Poll for bridge result (every 5 seconds, up to 4 minutes)
  const isFinished = Boolean(bridgeResult) || activeCall?.status === 'completed';
  const shouldPoll = Boolean(activeCall?.omixoCallId) && !isFinished && !isTimedOut && !isHungUpByMe;

  const { data: resultData } = useQuery({
    queryKey: ['bridgeResult', activeCall?.omixoCallId],
    queryFn: () => fetchBridgeResult(activeCall!.omixoCallId),
    enabled: shouldPoll,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.found || isTimedOut) {
        return false;
      }
      return 5000; // 5 seconds
    },
  });

  // Check if result is found
  useEffect(() => {
    if (resultData?.found && resultData.record) {
      setBridgeResult(resultData.record);
      // Refresh wallet balance
      void queryClient.invalidateQueries({ queryKey: ['account'] });
    }
  }, [resultData, queryClient]);

  // 4-minute timeout watcher
  useEffect(() => {
    if (!shouldPoll || !pollStartTime) return;

    const timer = setInterval(() => {
      const elapsed = Date.now() - pollStartTime;
      if (elapsed >= MAX_POLL_DURATION_MS) {
        setIsTimedOut(true);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [shouldPoll, pollStartTime]);

  // Mutation to start bridge call
  const startMutation = useMutation({
    mutationFn: () => startBridgeCall(agent.trim(), customer.trim()),
    onSuccess: (newCall) => {
      setInlineError(null);
      setNoPlanError(null);
      setActiveCall(newCall);
      setBridgeResult(null);
      setIsHungUpByMe(false);
      setIsTimedOut(false);
      setPollStartTime(Date.now());
    },
    onError: (err: Error & { errorSlug?: string; status?: number }) => {
      if (err.errorSlug === 'no_plan' || err.status === 402) {
        setNoPlanError(
          'This account has no active calling plan, so bridge calls are not available. Ask the account owner to enable calling.'
        );
        setInlineError(null);
      } else {
        setInlineError(err.message || 'Failed to originate bridge call');
        setNoPlanError(null);
      }
    },
  });

  // Mutation to hang up call
  const hangupMutation = useMutation({
    mutationFn: () => hangupBridgeCall(activeCall!.omixoCallId),
    onSuccess: () => {
      setIsHungUpByMe(true);
      if (activeCall) {
        setActiveCall({ ...activeCall, status: 'hung_up' });
      }
    },
    onError: (err: Error) => {
      setInlineError(err.message || 'Failed to hang up call');
    },
  });

  const isSubmitting = startMutation.isPending;
  const isCallInProgress = Boolean(activeCall) && !isFinished && !isHungUpByMe && !isTimedOut;
  const isSubmitDisabled =
    isSubmitting ||
    isCallInProgress ||
    !agent.trim() ||
    !customer.trim() ||
    agent.trim() === customer.trim();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setInlineError(null);
    setNoPlanError(null);

    if (!agent.trim()) {
      setInlineError('Please enter the agent phone number.');
      return;
    }

    if (!customer.trim()) {
      setInlineError('Please enter the customer phone number.');
      return;
    }

    if (agent.trim() === customer.trim()) {
      setInlineError('Agent and customer numbers must be different.');
      return;
    }

    startMutation.mutate();
  };

  return (
    <div className="bridge-page">
      <div className="panel">
        <h1 className="panel-title">Bridge call</h1>
        <p className="panel-description">
          Connect an agent and customer in a two-leg bridged telephone call.
        </p>

        {/* 3-line explainer at the top */}
        <div className="explainer-box" aria-label="Bridge call overview">
          <div className="explainer-line">1. The agent&apos;s phone rings first.</div>
          <div className="explainer-line">
            2. When the agent answers, the customer&apos;s phone rings.
          </div>
          <div className="explainer-line">
            3. The two are connected. The customer sees the business number as caller ID.
          </div>
        </div>

        {/* Distinct no_plan error banner */}
        {noPlanError && (
          <div className="no-plan-banner" role="alert">
            <div>
              <div className="no-plan-title">Calling Plan Required</div>
              <div>{noPlanError}</div>
            </div>
          </div>
        )}

        {/* Standard inline error banner */}
        {inlineError && (
          <div className="alert alert-error" role="alert">
            {inlineError}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          {/* Agent Number Field */}
          <div className="form-group">
            <label htmlFor="agent-input" className="form-label">
              Agent phone number (rings first)
            </label>
            <input
              id="agent-input"
              type="tel"
              className="form-input"
              value={agent}
              onChange={(e) => {
                setAgent(e.target.value);
                setInlineError(null);
              }}
              placeholder="e.g. 9876543210"
              disabled={isSubmitting || isCallInProgress}
              autoComplete="tel"
              required
            />

            {allowedNumbers.length > 0 && (
              <div className="chips-container" aria-label="Allowed test numbers for agent">
                <span className="chips-label">Allowed test numbers:</span>
                {allowedNumbers.map((num) => {
                  const isChosenInOther = customer === num;
                  return (
                    <button
                      key={num}
                      type="button"
                      className={`chip-button ${agent === num ? 'selected' : ''}`}
                      onClick={() => {
                        setAgent(num);
                        setInlineError(null);
                      }}
                      disabled={isSubmitting || isCallInProgress || isChosenInOther}
                      title={
                        isChosenInOther
                          ? 'Already selected as customer number'
                          : `Click to fill ${num}`
                      }
                    >
                      {num}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Customer Number Field */}
          <div className="form-group">
            <label htmlFor="customer-input" className="form-label">
              Customer phone number (bridged second)
            </label>
            <input
              id="customer-input"
              type="tel"
              className="form-input"
              value={customer}
              onChange={(e) => {
                setCustomer(e.target.value);
                setInlineError(null);
              }}
              placeholder="e.g. 9123456789"
              disabled={isSubmitting || isCallInProgress}
              autoComplete="tel"
              required
            />

            {allowedNumbers.length > 0 && (
              <div className="chips-container" aria-label="Allowed test numbers for customer">
                <span className="chips-label">Allowed test numbers:</span>
                {allowedNumbers.map((num) => {
                  const isChosenInOther = agent === num;
                  return (
                    <button
                      key={num}
                      type="button"
                      className={`chip-button ${customer === num ? 'selected' : ''}`}
                      onClick={() => {
                        setCustomer(num);
                        setInlineError(null);
                      }}
                      disabled={isSubmitting || isCallInProgress || isChosenInOther}
                      title={
                        isChosenInOther
                          ? 'Already selected as agent number'
                          : `Click to fill ${num}`
                      }
                    >
                      {num}
                    </button>
                  );
                })}
              </div>
            )}
            <p className="form-hint">
              {allowsAll
                ? 'Both agent and customer numbers must be 10 digits and must be different.'
                : 'Both numbers must be from the ALLOWED_NUMBERS list and must be different.'}
            </p>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={isSubmitDisabled}
          >
            {isSubmitting
              ? 'Starting bridge call...'
              : isCallInProgress
              ? 'Bridge call in progress...'
              : 'Start bridge call'}
          </button>
        </form>
      </div>

      {/* Bridge Call Status & Step Tracker */}
      {activeCall && (
        <section
          className="tracker-container"
          aria-live="polite"
          aria-label="Bridge Call Progress"
        >
          <div className="active-call-header">
            <div>
              <h2 style={{ fontSize: '1rem', fontWeight: 600 }}>Bridge Call Monitor</h2>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Call ID: <span className="mono-text">{activeCall.omixoCallId}</span>
              </span>
            </div>
            <div>
              {isHungUpByMe ? (
                <StatusBadge status="hung_up" />
              ) : isFinished ? (
                <StatusBadge status="completed" />
              ) : (
                <StatusBadge status="ringing_agent" />
              )}
            </div>
          </div>

          {/* Vertical Step Tracker */}
          <div className="step-tracker">
            {/* Step 1: Ringing agent */}
            <div className={`step-item ${isFinished ? 'completed' : 'active'}`}>
              <div className="step-circle">{isFinished ? '✓' : '1'}</div>
              <div className="step-content">
                <div className="step-title">Ringing agent</div>
                <div className="step-desc">
                  Dialing agent at <span className="mono-text">{activeCall.agentNumber || agent}</span>
                </div>
              </div>
            </div>

            {/* Step 2: Connecting customer */}
            <div className={`step-item ${isFinished ? 'completed' : 'pending'}`}>
              <div className="step-circle">{isFinished ? '✓' : '2'}</div>
              <div className="step-content">
                <div className="step-title">Connecting customer</div>
                <div className="step-desc">
                  Bridging customer at <span className="mono-text">{activeCall.to}</span> once agent answers
                </div>
              </div>
            </div>

            {/* Step 3: Finished */}
            <div className={`step-item ${isFinished ? 'completed' : 'pending'}`}>
              <div className="step-circle">{isFinished ? '✓' : '3'}</div>
              <div className="step-content">
                <div className="step-title">Finished</div>
                {isFinished && bridgeResult ? (
                  <div className="step-desc" style={{ marginTop: '0.4rem' }}>
                    <strong>Outcome:</strong> {bridgeResult.disposition} &bull;{' '}
                    <strong>Talk time:</strong> {bridgeResult.durationSec}s &bull;{' '}
                    <strong>Cost:</strong> ₹{bridgeResult.cost.toFixed(2)}
                  </div>
                ) : (
                  <div className="step-desc">Awaiting call completion and CDR logging</div>
                )}
              </div>
            </div>
          </div>

          {/* Action / Feedback controls */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '1rem',
              paddingTop: '0.75rem',
              borderTop: '1px solid var(--border-color)',
            }}
          >
            <div>
              {isHungUpByMe && (
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                  Call ended by you
                </span>
              )}
              {isTimedOut && !isFinished && (
                <span className="alert alert-info" style={{ display: 'inline-block', margin: 0 }}>
                  No record yet. Check the Call log page.
                </span>
              )}
            </div>

            {/* Hang up button: visible while call is not finished and not already hung up */}
            {!isFinished && !isHungUpByMe && (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => hangupMutation.mutate()}
                disabled={hangupMutation.isPending}
              >
                {hangupMutation.isPending ? 'Ending call...' : 'Hang up'}
              </button>
            )}
          </div>

          <div className="tracker-muted-note">
            Live progress is not available for bridge calls. The result appears when Omixo records the call.
          </div>
        </section>
      )}
    </div>
  );
};
