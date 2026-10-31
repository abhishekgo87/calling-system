import { Router, Request, Response } from 'express';
import { getMe } from '../omixo/client';
import { getFriendlyErrorMessage } from '../utils/errors';

const router = Router();

/**
 * GET /api/account
 * Returns only { name, status, walletBalance, currency } from Omixo getMe()
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await getMe();

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
      data: {
        name: result.data.name,
        status: result.data.status,
        walletBalance: result.data.walletBalance,
        currency: result.data.currency,
      },
    });
  } catch (error) {
    console.error('[API /api/account] Internal server error:', error);
    res.status(500).json({
      ok: false,
      error: 'internal_error',
      message: 'Failed to fetch account details',
    });
  }
});

export default router;
