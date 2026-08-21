import { Router, Request, Response, NextFunction } from 'express';
import { answerMessage, GREETING, QUICK_QUESTIONS } from '../services/chat.service';
import { sendSuccess } from '../utils/response';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { AppError } from '../utils/appError';

/**
 * Swachham assistant endpoints.
 *
 * Authenticated: the assistant can read the caller's own orders, so it must
 * know who is asking. Every lookup is scoped to that id — there is no route
 * in or out of this module that reaches another account's data.
 *
 * How answers are produced stays on the server. The app sends a message and
 * renders what comes back; it holds no prompt, no rules and no credentials.
 */
const router = Router();
router.use(authenticate);

/** The greeting and quick questions shown when the chat opens. */
router.get('/welcome', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, { greeting: GREETING, suggestions: QUICK_QUESTIONS }, 'Welcome');
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const message = req.body?.message;

    if (typeof message !== 'string' || !message.trim()) {
      throw new AppError('message is required', 400);
    }

    const reply = await answerMessage(authReq.user!.id, authReq.user!.role, {
      message,
      section: req.body?.section,
    });

    sendSuccess(res, reply, 'Reply generated');
  } catch (error) {
    next(error);
  }
});

export default router;
