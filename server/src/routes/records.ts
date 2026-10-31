import { Router, Request, Response } from 'express';
import { getCallRecords } from '../omixo/client';
import { getFriendlyErrorMessage } from '../utils/errors';

const router = Router();

/**
 * GET /api/records?limit=50
 * Proxies getCallRecords and returns normalized CDRs
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10) || 50, 1), 100);
    const result = await getCallRecords(limit);

    if (!result.ok) {
      const friendlyMessage = getFriendlyErrorMessage(result.status, result.error, result.message);
      res.status(result.status).json({
        ok: false,
        error: result.error,
        message: friendlyMessage,
      });
      return;
    }

    res.json({
      ok: true,
      data: result.data,
    });
  } catch (error) {
    console.error('[API GET /api/records] Error:', error);
    res.status(500).json({
      ok: false,
      error: 'internal_error',
      message: 'Failed to retrieve call detail records',
    });
  }
});

export default router;
