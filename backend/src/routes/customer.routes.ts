import { Router, Request, Response, NextFunction } from 'express';
import { getCustomerProfile, createOrUpdateCustomerProfile } from '../services/customer.service';
import { sendSuccess, sendError } from '../utils/response';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { query } from '../config/database';

const router = Router();
router.use(authenticate);

router.get('/profile', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const profile = await getCustomerProfile(authReq.user!.id);
    sendSuccess(res, profile, 'Customer profile fetched successfully');
  } catch (error) {
    next(error);
  }
});

router.put('/profile', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const profile = await createOrUpdateCustomerProfile(authReq.user!.id, req.body);
    sendSuccess(res, profile, 'Customer profile updated successfully');
  } catch (error) {
    next(error);
  }
});

router.post('/setup', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { name, role } = req.body;
    
    if (!name || name.trim().length < 2) {
      sendError(res, 'Name is required and must be at least 2 characters', 400);
      return;
    }
    
    // Update user name and role
    const validRoles = ['CUSTOMER', 'BUSINESS'];
    const userRole = validRoles.includes(role?.toUpperCase()) ? role.toUpperCase() : 'CUSTOMER';
    
    await query(
      `UPDATE users SET name = ?, role = ?, updated_at = NOW() WHERE id = ?`,
      [name.trim(), userRole, authReq.user!.id]
    );
    
    // Create/update customer profile
    await createOrUpdateCustomerProfile(authReq.user!.id, {
      username: name.trim()
    });
    
    // Fetch updated user
    const userResult = await query(
      `SELECT id, name, email, mobile_number as mobile, role, profile_image, is_active, created_at, updated_at FROM users WHERE id = ?`,
      [authReq.user!.id]
    );
    
    sendSuccess(res, userResult.rows[0], 'Profile setup complete', 200);
  } catch (error) {
    next(error);
  }
});

export default router;
