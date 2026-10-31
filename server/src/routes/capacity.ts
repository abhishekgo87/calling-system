import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { capacityService } from '../services/capacityService';
import { placeObdCall, getObdCall } from '../omixo/client';
import { normalizePhone, isValidTenDigitPhone } from '../utils/phone';
import type { ICapacityCall } from '../models/CapacityRun';

const router = Router();

const CAPACITY_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes between runs
const CAPACITY_TIMEOUT_MS = 90 * 1000; // 90 seconds max polling
const FIXED_MESSAGE = 'Namaste, ye capacity test call hai. Dhanyavaad!';

function isTerminalStatus(status?: string): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return s === 'completed' || s === 'no_answer' || s === 'failed';
}

// Zod schema for outbound capacity test request
const capacityRequestSchema = z.object({
  numbers: z
    .array(z.string().min(1, 'Phone number cannot be empty'))
    .min(1, 'At least 1 phone number is required for a capacity test'),
});

/**
 * Background poller for an active capacity run
 * Polls status every 2 seconds, tracks firstSeen offsets, and stops when all are final or 90s elapsed.
 */
function startBackgroundPoller(runId: string, startedAtMs: number): void {
  const intervalId = setInterval(async () => {
    try {
      const run = await capacityService.getRun(runId);
      if (!run || run.finishedAt) {
        clearInterval(intervalId);
        return;
      }

      const elapsedMs = Date.now() - startedAtMs;
      const isExpired = elapsedMs >= CAPACITY_TIMEOUT_MS;

      // Poll non-terminal accepted calls
      let callsModified = false;

      for (const call of run.calls) {
        if (call.requestOk && call.omixoCallId && !isTerminalStatus(call.finalStatus)) {
          const detailRes = await getObdCall(call.omixoCallId);
          if (detailRes.ok) {
            const apiCall = detailRes.data;
            const currentStatus = apiCall.status || call.finalStatus;
            const nowOffset = Date.now() - startedAtMs;

            if (currentStatus === 'ringing' && !call.firstSeen.ringing) {
              call.firstSeen.ringing = nowOffset;
              callsModified = true;
            }

            if (currentStatus === 'answered' && !call.firstSeen.answered) {
              call.firstSeen.answered = nowOffset;
              callsModified = true;
            }

            if (isTerminalStatus(currentStatus) && !call.firstSeen.final) {
              call.firstSeen.final = nowOffset;
              callsModified = true;
            }

            if (call.finalStatus !== currentStatus) {
              call.finalStatus = currentStatus;
              callsModified = true;
            }

            if (apiCall.disposition && call.disposition !== apiCall.disposition) {
              call.disposition = apiCall.disposition;
              callsModified = true;
            }

            if (
              apiCall.duration_sec !== undefined &&
              apiCall.duration_sec !== null &&
              call.durationSec !== apiCall.duration_sec
            ) {
              call.durationSec = apiCall.duration_sec;
              callsModified = true;
            }
          }
        }
      }

      const allCallsTerminal = run.calls.every(
        (c) => !c.requestOk || isTerminalStatus(c.finalStatus)
      );

      if (allCallsTerminal || isExpired) {
        clearInterval(intervalId);
        await capacityService.updateRun(runId, {
          calls: run.calls,
          finishedAt: new Date(),
        });
      } else if (callsModified) {
        await capacityService.updateRun(runId, {
          calls: run.calls,
        });
      }
    } catch (err) {
      console.error(`[Capacity Poller ${runId}] Error:`, err);
    }
  }, 2000);
}

/**
 * POST /api/capacity/outbound
 * Places N calls in parallel without awaiting one before starting the next
 */
router.post('/outbound', async (req: Request, res: Response) => {
  try {
    const parseResult = capacityRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0];
      res.status(422).json({
        ok: false,
        error: 'validation',
        message: firstIssue?.message || 'Invalid request body',
      });
      return;
    }

    const { numbers: rawNumbers } = parseResult.data;

    // Normalize each number to 10 digits
    const normalizedNumbers = rawNumbers.map((n) => normalizePhone(n));

    // Validate 10-digit format for all numbers
    for (let i = 0; i < normalizedNumbers.length; i++) {
      const num = normalizedNumbers[i];
      if (!num || !isValidTenDigitPhone(num)) {
        res.status(422).json({
          ok: false,
          error: 'validation',
          message: `Phone number "${rawNumbers[i]}" is invalid. It must resolve to a 10-digit number.`,
        });
        return;
      }
    }

    // Uniqueness check: numbers must be unique within a run (never the same number twice)
    const uniqueSet = new Set(normalizedNumbers);
    if (uniqueSet.size !== normalizedNumbers.length) {
      res.status(422).json({
        ok: false,
        error: 'validation',
        message: 'Phone numbers must be unique within a run. Duplicate numbers are not allowed.',
      });
      return;
    }

    // Allow-list check (if wildcard '*' is not present)
    const allowsAll = config.ALLOWED_NUMBERS.includes('*');
    if (!allowsAll) {
      for (const num of normalizedNumbers) {
        if (!config.ALLOWED_NUMBERS.includes(num)) {
          res.status(403).json({
            ok: false,
            error: 'forbidden',
            message: `Number ${num} is not in the ALLOWED_NUMBERS list.`,
          });
          return;
        }
      }
    }

    // Enforce 1 run at a time and at most 1 run per 2 minutes
    const lastRun = await capacityService.getLastRun();
    if (lastRun) {
      const lastStartedTime = new Date(lastRun.startedAt).getTime();
      const elapsedSinceLastStart = Date.now() - lastStartedTime;

      // Active run guard
      if (!lastRun.finishedAt && elapsedSinceLastStart < CAPACITY_TIMEOUT_MS) {
        res.status(429).json({
          ok: false,
          error: 'rate_limited',
          message:
            'A capacity test is currently in progress. Only one run can be active at a time.',
        });
        return;
      }

      // 2-minute cooldown guard
      if (elapsedSinceLastStart < CAPACITY_COOLDOWN_MS) {
        const remainingSeconds = Math.ceil((CAPACITY_COOLDOWN_MS - elapsedSinceLastStart) / 1000);
        res.status(429).json({
          ok: false,
          error: 'rate_limited',
          message: `Please wait ${remainingSeconds} seconds before starting another capacity run (limit: 1 run per 2 minutes).`,
        });
        return;
      }
    }

    const startedAt = new Date();
    const startedAtMs = startedAt.getTime();

    // Initial placeholder calls array
    const initialCalls: ICapacityCall[] = normalizedNumbers.map((num) => ({
      number: num,
      requestOk: false,
      requestSentAtMs: 0,
      requestDoneAtMs: 0,
      firstSeen: {},
      finalStatus: 'initiating',
    }));

    // Create the run document
    const createdRun = await capacityService.createRun({
      startedAt,
      numbers: normalizedNumbers,
      calls: initialCalls,
    });

    const runId = createdRun.id || '';

    // Fire all placeObdCall calls with Promise.allSettled without awaiting one before starting the next
    const dispatchPromises = normalizedNumbers.map(async (phone) => {
      const requestSentAtMs = Date.now() - startedAtMs;
      try {
        const omixoRes = await placeObdCall(phone, FIXED_MESSAGE);
        const requestDoneAtMs = Date.now() - startedAtMs;

        if (omixoRes.ok) {
          const callObj = omixoRes.data;
          const callId = String(callObj.id);
          const initialStatus = callObj.status || 'queued';

          const callResult: ICapacityCall = {
            number: phone,
            requestOk: true,
            omixoCallId: callId,
            requestSentAtMs,
            requestDoneAtMs,
            firstSeen: {
              queued: requestDoneAtMs,
            },
            finalStatus: initialStatus,
          };
          return callResult;
        } else {
          const callResult: ICapacityCall = {
            number: phone,
            requestOk: false,
            requestError: omixoRes.error || 'call_failed',
            requestSentAtMs,
            requestDoneAtMs,
            firstSeen: {},
            finalStatus: 'failed',
          };
          return callResult;
        }
      } catch (err) {
        const requestDoneAtMs = Date.now() - startedAtMs;
        const callResult: ICapacityCall = {
          number: phone,
          requestOk: false,
          requestError: 'network_error',
          requestSentAtMs,
          requestDoneAtMs,
          firstSeen: {},
          finalStatus: 'failed',
        };
        return callResult;
      }
    });

    // Wait for all HTTP initial requests to settle so the run response has initial status
    const settledResults = await Promise.all(dispatchPromises);

    // Update run document with the settled call requests
    const updatedRun = await capacityService.updateRun(runId, {
      calls: settledResults,
    });

    // Start background poller to monitor ringing / answer / completion
    startBackgroundPoller(runId, startedAtMs);

    res.status(201).json({
      ok: true,
      data: updatedRun || { ...createdRun, calls: settledResults },
    });
  } catch (error) {
    console.error('[API POST /api/capacity/outbound] Error:', error);
    res.status(500).json({
      ok: false,
      error: 'internal_error',
      message: 'Failed to originate outbound capacity test run',
    });
  }
});

/**
 * GET /api/capacity/:runId
 * Returns a specific run record by id
 */
router.get('/:runId', async (req: Request, res: Response) => {
  try {
    const runId = req.params.runId;
    if (!runId || typeof runId !== 'string') {
      res.status(400).json({
        ok: false,
        error: 'missing_id',
        message: 'Capacity run ID is required',
      });
      return;
    }

    const run = await capacityService.getRun(runId);
    if (!run) {
      res.status(404).json({
        ok: false,
        error: 'not_found',
        message: 'Capacity test run not found',
      });
      return;
    }

    res.json({
      ok: true,
      data: run,
    });
  } catch (error) {
    console.error('[API GET /api/capacity/:runId] Error:', error);
    res.status(500).json({
      ok: false,
      error: 'internal_error',
      message: 'Failed to fetch capacity test run',
    });
  }
});

/**
 * GET /api/capacity
 * Returns the last 10 capacity test runs
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const runs = await capacityService.listRuns(10);
    res.json({
      ok: true,
      data: runs,
    });
  } catch (error) {
    console.error('[API GET /api/capacity] Error:', error);
    res.status(500).json({
      ok: false,
      error: 'internal_error',
      message: 'Failed to fetch capacity test history',
    });
  }
});

export default router;
