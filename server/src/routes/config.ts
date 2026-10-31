import { Router, Request, Response } from 'express';
import { config } from '../config';

const router = Router();

/**
 * GET /api/config
 * Returns allowed numbers list for the UI chips and validation hints.
 */
router.get('/', (_req: Request, res: Response) => {
  res.json({
    allowedNumbers: config.ALLOWED_NUMBERS,
  });
});

export default router;
