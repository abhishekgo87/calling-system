import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchConfig, startCapacityTest, fetchCapacityRun, fetchCapacityRuns } from '../api/client';
import type { CapacityRunRecord, CapacityCallRecord } from '../api/types';
import { StatusBadge } from '../components/StatusBadge';

// Helper to clean and validate 10-digit phone
function cleanDigits(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

// Format milliseconds offset to "1.5s"
function formatOffset(ms?: number): string {
  if (ms === undefined || ms === null) return '—';
  return `${(ms / 1000).toFixed(1)}s`;
}

// Format ISO date nicely
function formatRunDate(dateStr: string): string {
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

export const CapacityPage: React.FC = () => {
  const queryClient = useQueryClient();

  // Selected phone numbers (2 to 5)
  const [selectedNumbers, setSelectedNumbers] = useState<string[]>([]);
  const [customPhoneInput, setCustomPhoneInput] = useState('');
  const [consentChecked, setConsentChecked] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  // Active run tracking
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [selectedHistoricRun, setSelectedHistoricRun] = useState<CapacityRunRecord | null>(null);

  // 1. Fetch config for allowed test numbers
  const { data: configData } = useQuery({
    queryKey: ['config'],
    queryFn: fetchConfig,
    staleTime: 60000,
  });

  const rawAllowed = configData?.allowedNumbers || [];
  const allowedChipList = rawAllowed.filter((n) => n !== '*');

  // 2. Fetch history of last 10 runs
  const { data: historyRuns, refetch: refetchHistory } = useQuery({
    queryKey: ['capacityHistory'],
    queryFn: fetchCapacityRuns,
    staleTime: 5000,
  });

  // Automatically check if there is an ongoing run from history
  useEffect(() => {
    if (!activeRunId && historyRuns && historyRuns.length > 0) {
      const latest = historyRuns[0];
      if (latest && !latest.finishedAt) {
        const elapsed = Date.now() - new Date(latest.startedAt).getTime();
        if (elapsed < 90000) {
          setActiveRunId(latest.id || latest._id || null);
        }
      }
    }
  }, [historyRuns, activeRunId]);

  // 3. Poll active run every 2 seconds until finished
  const { data: currentRun } = useQuery({
    queryKey: ['capacityRun', activeRunId],
    queryFn: () => fetchCapacityRun(activeRunId!),
    enabled: Boolean(activeRunId),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.finishedAt) {
        return false;
      }
      return 2000; // 2 seconds
    },
  });

  // Refresh history and wallet when active run finishes
  useEffect(() => {
    if (currentRun?.finishedAt) {
      void refetchHistory();
      void queryClient.invalidateQueries({ queryKey: ['account'] });
    }
  }, [currentRun?.finishedAt, refetchHistory, queryClient]);

  // Mutation to start capacity test
  const startMutation = useMutation({
    mutationFn: () => startCapacityTest(selectedNumbers),
    onSuccess: (newRun) => {
      setInlineError(null);
      setSelectedHistoricRun(null);
      const runId = newRun.id || newRun._id;
      if (runId) {
        setActiveRunId(runId);
      }
      void refetchHistory();
    },
    onError: (err: Error) => {
      setInlineError(err.message || 'Failed to start capacity test');
    },
  });

  // Toggle chip selection
  const handleToggleChip = (phone: string) => {
    setInlineError(null);
    const ten = cleanDigits(phone);
    if (!ten) return;

    if (selectedNumbers.includes(ten)) {
      setSelectedNumbers(selectedNumbers.filter((n) => n !== ten));
    } else {
      setSelectedNumbers([...selectedNumbers, ten]);
    }
  };

  // Add custom typed number (supports single or comma/space-separated numbers)
  const handleAddCustomNumber = (e: React.FormEvent) => {
    e.preventDefault();
    setInlineError(null);
    if (!customPhoneInput.trim()) return;

    const rawTokens = customPhoneInput.split(/[\s,]+/);
    const validTokens: string[] = [];
    const invalidTokens: string[] = [];

    for (const raw of rawTokens) {
      if (!raw) continue;
      const ten = cleanDigits(raw);
      if (ten && ten.length === 10) {
        if (!selectedNumbers.includes(ten) && !validTokens.includes(ten)) {
          validTokens.push(ten);
        }
      } else {
        invalidTokens.push(raw);
      }
    }

    if (invalidTokens.length > 0 && validTokens.length === 0) {
      setInlineError(`Invalid phone number(s): ${invalidTokens.join(', ')}. Must resolve to 10 digits.`);
      return;
    }

    if (validTokens.length === 0) {
      setInlineError('All entered number(s) are already in the list.');
      return;
    }

    setSelectedNumbers([...selectedNumbers, ...validTokens]);
    setCustomPhoneInput('');
  };

  const handleRemoveNumber = (num: string) => {
    setInlineError(null);
    setSelectedNumbers(selectedNumbers.filter((n) => n !== num));
  };

  const isSubmitting = startMutation.isPending;
  const isRunActive = Boolean(currentRun && !currentRun.finishedAt);
  const isRunButtonDisabled =
    isSubmitting ||
    isRunActive ||
    !consentChecked ||
    selectedNumbers.length < 1;

  const displayedRun = selectedHistoricRun || currentRun;

  // Analysis calculations for summary
  const renderSummary = (run: CapacityRunRecord) => {
    const totalCalls = run.calls.length;
    const acceptedCalls = run.calls.filter((c) => c.requestOk).length;

    // Ringing times of accepted calls
    const ringingOffsets = run.calls
      .filter((c) => c.requestOk && c.firstSeen.ringing !== undefined)
      .map((c) => c.firstSeen.ringing!)
      .sort((a, b) => a - b);

    const firstRingingTime = ringingOffsets.length > 0 ? ringingOffsets[0] : null;
    const withinFiveSecondsCount =
      firstRingingTime !== null
        ? ringingOffsets.filter((time) => time - firstRingingTime <= 5000).length
        : 0;

    const allTogether = withinFiveSecondsCount === totalCalls && totalCalls > 0;
    const someDelayedOrFailed =
      run.calls.some((c) => !c.requestOk) ||
      (run.finishedAt && withinFiveSecondsCount < acceptedCalls);

    return (
      <div className="capacity-summary-card" aria-label="Capacity Run Analysis">
        <div className="capacity-summary-header">Test Run Analysis</div>
        <ul className="capacity-summary-list">
          <li>
            <strong>{acceptedCalls} of {totalCalls}</strong> calls were accepted by Omixo.
          </li>
          {ringingOffsets.length > 0 && (
            <li>
              <strong>{withinFiveSecondsCount} of {totalCalls}</strong> were ringing within 5 seconds of the first one.
              {allTogether && (
                <span className="summary-highlight-good"> All calls started together.</span>
              )}
            </li>
          )}
          {someDelayedOrFailed && (
            <li className="summary-highlight-warn">
              Some calls did not start together. This may indicate a concurrency limit, but ask Omixo to confirm.
            </li>
          )}
          <li className="summary-honest-limit">
            This test only covers {totalCalls} phones, so it does not show the maximum.
          </li>
        </ul>
      </div>
    );
  };

  return (
    <div className="capacity-page">
      <div className="panel">
        <h1 className="panel-title">Outbound capacity test</h1>
        <p className="panel-description">
          Find out how many outbound calls Omixo starts at the same time on this account.
        </p>

        {/* Honest limit notice box */}
        <div className="capacity-honest-box">
          <span className="honest-badge">Honest limit:</span>
          <span>
            This test can only show behavior up to the number of phones available. If 4 phones are used and all 4 ring together, the result is &ldquo;at least 4 concurrent calls worked&rdquo;, not the maximum.
          </span>
        </div>

        {/* Inline error banner */}
        {inlineError && (
          <div className="alert alert-error" role="alert" style={{ marginBottom: '1rem' }}>
            {inlineError}
          </div>
        )}

        {/* Number Selector Form */}
        <div className="form-group" style={{ marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.4rem' }}>
            <label className="form-label" style={{ marginBottom: 0 }}>
              Enter or select test phone numbers
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '0.85rem', color: selectedNumbers.length === 0 ? 'var(--text-muted)' : 'var(--accent)' }}>
                Selected: <strong>{selectedNumbers.length}</strong> {selectedNumbers.length === 1 ? 'phone' : 'phones'}
              </span>
              {selectedNumbers.length > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ fontSize: '0.72rem', padding: '1px 6px', height: 'auto' }}
                  onClick={() => setSelectedNumbers([])}
                  disabled={isRunActive || isSubmitting}
                >
                  Clear all
                </button>
              )}
            </div>
          </div>

          {/* Quick select chips from ALLOWED_NUMBERS */}
          {allowedChipList.length > 0 && (
            <div className="chips-container" aria-label="Available test phones">
              <span className="chips-label">Quick select:</span>
              {allowedChipList.map((num) => {
                const isSelected = selectedNumbers.includes(num);
                return (
                  <button
                    key={num}
                    type="button"
                    className={`chip-button ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleToggleChip(num)}
                    disabled={isRunActive || isSubmitting}
                    title={isSelected ? `Click to deselect ${num}` : `Click to select ${num}`}
                  >
                    {isSelected ? `✓ ${num}` : `+ ${num}`}
                  </button>
                );
              })}
            </div>
          )}

          {/* Custom phone input field */}
          <form onSubmit={handleAddCustomNumber} style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
            <input
              type="tel"
              className="form-input"
              style={{ flex: 1 }}
              placeholder="Enter phone numbers (e.g. 9876543210 or paste multiple separated by commas)"
              value={customPhoneInput}
              onChange={(e) => {
                setCustomPhoneInput(e.target.value);
                setInlineError(null);
              }}
              disabled={isRunActive || isSubmitting}
            />
            <button
              type="submit"
              className="btn btn-secondary btn-sm"
              disabled={isRunActive || isSubmitting || !customPhoneInput.trim()}
            >
              Add number
            </button>
          </form>

          {/* Selected phone tags */}
          {selectedNumbers.length > 0 && (
            <div className="selected-numbers-box">
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Phones to dial:</span>
              <div className="selected-tags-wrap">
                {selectedNumbers.map((num) => (
                  <span key={num} className="selected-phone-tag">
                    <span className="mono-text">{num}</span>
                    <button
                      type="button"
                      className="tag-remove-btn"
                      onClick={() => handleRemoveNumber(num)}
                      disabled={isRunActive || isSubmitting}
                      title={`Remove ${num}`}
                      aria-label={`Remove ${num}`}
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Safety & Cost Disclaimer */}
        <div className="capacity-safety-box">
          <div className="capacity-fixed-msg">
            <strong>Fixed spoken message:</strong> &ldquo;Namaste, ye capacity test call hai. Dhanyavaad!&rdquo;
          </div>
          <div className="capacity-warning-text">
            This will ring <strong>{selectedNumbers.length || 'N'}</strong> phones at once. Each answered call costs about ₹0.30. Use only phones that belong to you or the test team.
          </div>

          <label className="capacity-checkbox-label">
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
              disabled={isRunActive || isSubmitting}
            />
            <span>These phones are ready and belong to the test team</span>
          </label>
        </div>

        {/* Run Test Button */}
        <div style={{ marginTop: '1.25rem' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => startMutation.mutate()}
            disabled={isRunButtonDisabled}
          >
            {isSubmitting
              ? 'Starting capacity test...'
              : isRunActive
              ? 'Capacity test in progress...'
              : 'Run test'}
          </button>
          {isRunActive && (
            <span style={{ marginLeft: '1rem', fontSize: '0.85rem', color: 'var(--accent)' }}>
              Polling call progression (every 2s)...
            </span>
          )}
        </div>
      </div>

      {/* Results Section */}
      {displayedRun && (
        <section className="panel" style={{ marginTop: '1.5rem' }} aria-live="polite">
          <div className="capacity-results-header">
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>
                {selectedHistoricRun ? 'Historical Test Result' : 'Live Capacity Test Monitor'}
              </h2>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                Started at: <span className="mono-text">{formatRunDate(displayedRun.startedAt)}</span>
                {displayedRun.finishedAt ? (
                  <span className="status-finished-pill">Finished</span>
                ) : (
                  <span className="status-running-pill">Active</span>
                )}
              </div>
            </div>

            {selectedHistoricRun && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setSelectedHistoricRun(null)}
              >
                Back to latest run
              </button>
            )}
          </div>

          {/* Results Table */}
          <div className="table-responsive" style={{ marginTop: '1rem' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Phone Number</th>
                  <th scope="col">Request Result</th>
                  <th scope="col">Time to Ringing</th>
                  <th scope="col">Time to Answered</th>
                  <th scope="col">Status</th>
                  <th scope="col">Talk Time</th>
                </tr>
              </thead>
              <tbody>
                {displayedRun.calls.map((call: CapacityCallRecord) => (
                  <tr key={call.number}>
                    <td className="mono-text font-semibold">{call.number}</td>
                    <td>
                      {call.requestOk ? (
                        <span className="capacity-accepted-badge">Accepted</span>
                      ) : (
                        <span className="capacity-rejected-badge">
                          {call.requestError || 'Rejected'}
                        </span>
                      )}
                    </td>
                    <td>
                      {call.firstSeen.ringing !== undefined ? (
                        <span className="mono-text" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                          {formatOffset(call.firstSeen.ringing)}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-subtle)' }}>—</span>
                      )}
                    </td>
                    <td>
                      {call.firstSeen.answered !== undefined ? (
                        <span className="mono-text" style={{ color: 'var(--success)', fontWeight: 600 }}>
                          {formatOffset(call.firstSeen.answered)}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-subtle)' }}>—</span>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={call.finalStatus || 'queued'} />
                    </td>
                    <td className="mono-text">
                      {call.durationSec !== undefined && call.durationSec !== null ? (
                        `${call.durationSec}s`
                      ) : (
                        <span style={{ color: 'var(--text-subtle)' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Summary analysis card */}
          {renderSummary(displayedRun)}
        </section>
      )}

      {/* History List of last 10 runs */}
      {historyRuns && historyRuns.length > 0 && (
        <section className="panel" style={{ marginTop: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.8rem' }}>
            Previous Capacity Runs (Last 10)
          </h2>
          <div className="capacity-history-list">
            {historyRuns.map((run) => {
              const runId = run.id || run._id;
              const isSelected = selectedHistoricRun?.id === runId || selectedHistoricRun?._id === runId;
              const accepted = run.calls.filter((c) => c.requestOk).length;
              const total = run.calls.length;

              return (
                <div
                  key={runId}
                  className={`capacity-history-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => setSelectedHistoricRun(run)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <strong style={{ fontSize: '0.88rem' }}>{formatRunDate(run.startedAt)}</strong>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                        {total} phones tested &bull; {accepted}/{total} accepted
                      </div>
                    </div>
                    <div>
                      {run.finishedAt ? (
                        <span className="status-badge" style={{ fontSize: '0.72rem', backgroundColor: 'var(--success-bg)', color: 'var(--success)', borderColor: 'var(--success-border)' }}>
                          Completed
                        </span>
                      ) : (
                        <span className="status-badge" style={{ fontSize: '0.72rem', backgroundColor: 'var(--accent-subtle)', color: 'var(--accent)', borderColor: 'var(--accent-border)' }}>
                          Running
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
};

export default CapacityPage;
