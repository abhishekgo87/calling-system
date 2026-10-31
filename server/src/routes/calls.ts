import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config';
import { callService } from '../services/callService';
import { placeObdCall, getObdCall } from '../omixo/client';
import { normalizePhone, isValidTenDigitPhone } from '../utils/phone';
import { getFriendlyErrorMessage } from '../utils/errors';

const router = Router();

// Hard Security Rule: Server-side rate limit of 20 requests per minute on POST /api/calls
const placeCallRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: 'rate_limited',
    message: 'Too many requests, wait a minute.',
  },
});

// Zod schema for POST /api/calls body validation
const placeCallSchema = z.object({
  to: z
    .string({
      required_error: 'Phone number is required',
    })
    .min(1, 'Phone number cannot be empty'),
  message: z
    .string({
      required_error: 'Message is required',
    })
    .min(1, 'Message cannot be empty')
    .max(800, 'Message cannot exceed 800 characters'),
});

/**
 * POST /api/calls
 * Places an OBD call after validation and allow-list check
 */
router.post('/', placeCallRateLimiter, async (req: Request, res: Response) => {
  try {
    const parseResult = placeCallSchema.safeParse(req.body);
    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0];
      res.status(422).json({
        ok: false,
        error: 'validation',
        message: firstIssue?.message || 'Invalid request body',
      });
      return;
    }

    const { to: rawTo, message } = parseResult.data;
    const normalizedPhone = normalizePhone(rawTo);

    if (!isValidTenDigitPhone(normalizedPhone)) {
      res.status(422).json({
        ok: false,
        error: 'validation',
        message: 'Phone number must resolve to a valid 10-digit number',
      });
      return;
    }

    // Enforce ALLOWED_NUMBERS unless wildcard '*' is configured
    const allowsAllNumbers = config.ALLOWED_NUMBERS.includes('*');
    if (!allowsAllNumbers && !config.ALLOWED_NUMBERS.includes(normalizedPhone)) {
      res.status(403).json({
        ok: false,
        error: 'forbidden',
        message: `Calling ${normalizedPhone} is not allowed. Only numbers in ALLOWED_NUMBERS are permitted.`,
      });
      return;
    }

    // Call Omixo API to place call
    const omixoResult = await placeObdCall(normalizedPhone, message);

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

    // Save initial call record
    const omixoCallId = String(omixoResult.data.id);
    const callDoc = await callService.createCall({
      omixoCallId,
      to: normalizedPhone,
      message,
      status: omixoResult.data.status || 'queued',
      source: 'obd',
      placedAt: new Date(),
    });

    res.status(201).json({
      ok: true,
      data: callDoc,
    });
  } catch (error) {
    console.error('[API POST /api/calls] Error placing call:', error);
    res.status(500).json({
      ok: false,
      error: 'internal_error',
      message: 'Failed to initiate call',
    });
  }
});

/**
 * GET /api/calls
 * Returns calls placed from this app in MongoDB, newest first
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10) || 50, 1), 100);
    const calls = await callService.listCalls(limit);

    res.json({
      ok: true,
      data: calls,
    });
  } catch (error) {
    console.error('[API GET /api/calls] Error fetching calls:', error);
    res.status(500).json({
      ok: false,
      error: 'internal_error',
      message: 'Failed to retrieve call history',
    });
  }
});

/**
 * GET /api/calls/:omixoCallId
 * Calls getObdCall, updates Mongo document, and returns updated document
 */
router.get('/:omixoCallId', async (req: Request, res: Response) => {
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

    const omixoResult = await getObdCall(omixoCallId);

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

    const apiCall = omixoResult.data;

    // Update MongoDB document with status, disposition, duration and timestamps
    const updateData: {
      status: string;
      disposition?: string;
      durationSec?: number;
      answeredAt?: Date;
      completedAt?: Date;
    } = {
      status: apiCall.status,
    };

    if (apiCall.disposition !== undefined) {
      updateData.disposition = apiCall.disposition;
    }
    if (apiCall.duration_sec !== undefined) {
      updateData.durationSec = apiCall.duration_sec;
    }
    if (apiCall.answered_at) {
      updateData.answeredAt = new Date(apiCall.answered_at);
    }
    if (apiCall.completed_at) {
      updateData.completedAt = new Date(apiCall.completed_at);
    }

    const updatedDoc = await callService.updateCall(omixoCallId, updateData);

    if (!updatedDoc) {
      res.status(404).json({
        ok: false,
        error: 'call_not_found',
        message: `Call with ID ${omixoCallId} not found in database`,
      });
      return;
    }

    res.json({
      ok: true,
      data: updatedDoc,
    });
  } catch (error) {
    console.error(`[API GET /api/calls/:omixoCallId] Error:`, error);
    res.status(500).json({
      ok: false,
      error: 'internal_error',
      message: 'Failed to update call status',
    });
  }
});

export default router;
