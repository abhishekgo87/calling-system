import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config';
import { callService } from '../services/callService';
import { clickToCall, hangupCall, getCallRecords } from '../omixo/client';
import { normalizePhone, isValidTenDigitPhone } from '../utils/phone';
import { getFriendlyErrorMessage } from '../utils/errors';
import type { NormalizedCdrRecord } from '../omixo/types';

const router = Router();

// Rate limit: 10 requests per minute on POST /api/bridge
const bridgeRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: 'rate_limited',
    message: 'Too many requests, wait a minute.',
  },
});

// Zod schema for bridge call request
const bridgeCallSchema = z.object({
  agent: z
    .string({
      required_error: 'Agent phone number is required',
    })
    .min(1, 'Agent phone number cannot be empty'),
  customer: z
    .string({
      required_error: 'Customer phone number is required',
    })
    .min(1, 'Customer phone number cannot be empty'),
});

/**
 * POST /api/bridge
 * Originates a bridge call (click-to-call)
 */
router.post('/', bridgeRateLimiter, async (req: Request, res: Response) => {
  try {
    const parseResult = bridgeCallSchema.safeParse(req.body);
    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0];
      res.status(422).json({
        ok: false,
        error: 'validation',
        message: firstIssue?.message || 'Invalid request body',
      });
      return;
    }

    const { agent: rawAgent, customer: rawCustomer } = parseResult.data;
    const agent = normalizePhone(rawAgent);
    const customer = normalizePhone(rawCustomer);

    if (!isValidTenDigitPhone(agent)) {
      res.status(422).json({
        ok: false,
        error: 'validation',
        message: 'Agent phone number must resolve to a valid 10-digit number',
      });
      return;
    }

    if (!isValidTenDigitPhone(customer)) {
      res.status(422).json({
        ok: false,
        error: 'validation',
        message: 'Customer phone number must resolve to a valid 10-digit number',
      });
      return;
    }

    // Both numbers must be different (422)
    if (agent === customer) {
      res.status(422).json({
        ok: false,
        error: 'validation',
        message: 'Agent and customer numbers must be different.',
      });
      return;
    }

    // Check allow-list for both numbers (403 if unlisted, unless wildcard '*' is present)
    const allowsAll = config.ALLOWED_NUMBERS.includes('*');
    if (!allowsAll) {
      if (!config.ALLOWED_NUMBERS.includes(agent)) {
        res.status(403).json({
          ok: false,
          error: 'forbidden',
          message: `Agent number ${agent} is not in the ALLOWED_NUMBERS list.`,
        });
        return;
      }
      if (!config.ALLOWED_NUMBERS.includes(customer)) {
        res.status(403).json({
          ok: false,
          error: 'forbidden',
          message: `Customer number ${customer} is not in the ALLOWED_NUMBERS list.`,
        });
        return;
      }
    }

    // Format 10-digit Indian numbers with 91 prefix required by Omixo Asterisk CPaaS dialplan
    const formatForOmixo = (phone: string) => {
      const ten = normalizePhone(phone);
      return ten.length === 10 ? `91${ten}` : ten;
    };

    // Call Omixo Click-to-Call API
    const omixoResult = await clickToCall({
      agent: formatForOmixo(agent),
      destination: formatForOmixo(customer),
    });

    if (!omixoResult.ok) {
      const friendlyMessage = getFriendlyErrorMessage(
        omixoResult.status,
        omixoResult.error,
        omixoResult.message
      );
      res.status(omixoResult.status).json({
        ok: false,
        error: omixoResult.error,
        message: friendlyMessage,
      });
      return;
    }

    // Save initial bridge call document in MongoDB
    const omixoCallId = String(omixoResult.data.call_id);
    const callDoc = await callService.createCall({
      omixoCallId,
      to: customer,
      status: 'ringing_agent',
      source: 'click_to_call',
      agentNumber: agent,
      callerId: omixoResult.data.caller_id,
      placedAt: new Date(),
    });

    res.status(201).json({
      ok: true,
      data: callDoc,
    });
  } catch (error) {
    console.error('[API POST /api/bridge] Error originating bridge call:', error);
    res.status(500).json({
      ok: false,
      error: 'internal_error',
      message: 'Failed to originate bridge call',
    });
  }
});

/**
 * POST /api/bridge/:omixoCallId/hangup
 * Hangs up an active bridge call and marks status as "hung_up"
 */
router.post('/:omixoCallId/hangup', async (req: Request, res: Response) => {
  try {
    const omixoCallId = req.params.omixoCallId;
    if (!omixoCallId || typeof omixoCallId !== 'string') {
      res.status(400).json({
        ok: false,
        error: 'missing_id',
        message: 'Omixo call ID is required',
      });
      return;
    }

    // Attempt to hang up via Omixo
    await hangupCall(omixoCallId);

    // Update status in Mongo to hung_up
    const updatedCall = await callService.updateCall(omixoCallId, {
      status: 'hung_up',
    });

    res.json({
      ok: true,
      data: updatedCall,
    });
  } catch (error) {
    console.error('[API POST /api/bridge/:omixoCallId/hangup] Error:', error);
    res.status(500).json({
      ok: false,
      error: 'internal_error',
      message: 'Failed to hang up bridge call',
    });
  }
});

/**
 * GET /api/bridge/:omixoCallId/result
 * Matches a bridge call with Omixo CDR records (GET /calls/records)
 */
router.get('/:omixoCallId/result', async (req: Request, res: Response) => {
  try {
    const omixoCallId = req.params.omixoCallId;
    if (!omixoCallId || typeof omixoCallId !== 'string') {
      res.status(400).json({
        ok: false,
        error: 'missing_id',
        message: 'Omixo call ID is required',
      });
      return;
    }

    const call = await callService.findByOmixoId(omixoCallId);
    if (!call) {
      res.status(404).json({
        ok: false,
        error: 'call_not_found',
        message: 'Bridge call not found in database',
      });
      return;
    }

    // If call is already completed, return existing completion state
    if (call.status === 'completed' && call.disposition !== undefined) {
      const syntheticRecord: NormalizedCdrRecord = {
        cdrId: `cdr_${call.omixoCallId}`,
        direction: 'outbound',
        from: call.callerId || call.agentNumber || 'Unknown',
        to: call.to,
        durationSec: call.durationSec || 0,
        disposition: call.disposition || 'ANSWERED',
        cost: call.cost || 0,
        startedAt: call.placedAt.toISOString(),
      };
      res.json({
        found: true,
        record: syntheticRecord,
      });
      return;
    }

    // Fetch latest 50 CDR records
    const cdrResult = await getCallRecords(50);
    if (!cdrResult.ok) {
      res.status(cdrResult.status).json({
        found: false,
        error: cdrResult.error,
        message: cdrResult.message,
      });
      return;
    }

    const customer10 = normalizePhone(call.to);
    const agent10 = call.agentNumber ? normalizePhone(call.agentNumber) : '';
    const placedTimeMs = new Date(call.placedAt).getTime();
    // Allow up to 5 seconds before placedAt for minor clock skew between server and Omixo,
    // but never match previous calls placed minutes earlier.
    const minStartedTimeMs = placedTimeMs - 5 * 1000;

    // Find best match meeting all criteria:
    // 1) direction is outbound
    // 2) NOT an automated OBD call or campaign call (bridge calls originate from business DID)
    // 3) started_at is at or after call was placed (- 5s clock skew)
    // 4) record's to or from matches customer or agent 10 digits
    const matchingRecords = cdrResult.data.filter((rec) => {
      if (rec.direction !== 'outbound') {
        return false;
      }

      // Exclude automated OBD calls (e.g. from: "obd:1408") and broadcast campaign calls
      if (rec.from.startsWith('obd:') || rec.from.startsWith('campaign:')) {
        return false;
      }

      const recTimeMs = new Date(rec.startedAt).getTime();
      if (!isNaN(recTimeMs) && recTimeMs < minStartedTimeMs) {
        return false;
      }

      const cleanTo = normalizePhone(rec.to);
      const cleanFrom = normalizePhone(rec.from);

      const matchesCustomer =
        (customer10 && cleanTo.includes(customer10)) ||
        (customer10 && cleanFrom.includes(customer10));
      const matchesAgent =
        (agent10 && cleanTo.includes(agent10)) ||
        (agent10 && cleanFrom.includes(agent10));

      return matchesCustomer || matchesAgent;
    });

    if (matchingRecords.length === 0) {
      res.json({
        found: false,
      });
      return;
    }

    // Best match is most recent
    const bestMatch = matchingRecords[0]!;

    // Store disposition, durationSec, cost and mark status completed
    await callService.updateCall(omixoCallId, {
      status: 'completed',
      disposition: bestMatch.disposition,
      durationSec: bestMatch.durationSec,
      cost: bestMatch.cost,
      completedAt: new Date(),
    });

    res.json({
      found: true,
      record: bestMatch,
    });
  } catch (error) {
    console.error('[API GET /api/bridge/:omixoCallId/result] Error:', error);
    res.status(500).json({
      ok: false,
      error: 'internal_error',
      message: 'Failed to retrieve bridge call result',
    });
  }
});

export default router;
