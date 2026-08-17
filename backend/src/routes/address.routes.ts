import { Router, Request, Response, NextFunction } from 'express';
import { getAddresses, addAddress, updateAddress, deleteAddress, setDefault } from '../services/address.service';
import { sendSuccess } from '../utils/response';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const addresses = await getAddresses(authReq.user!.id);
    sendSuccess(res, addresses, 'Addresses fetched successfully');
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const address = await addAddress(authReq.user!.id, req.body);
    sendSuccess(res, address, 'Address added successfully', 201);
  } catch (error) {
    next(error);
  }
});

router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const address = await updateAddress(authReq.user!.id, req.params.id, req.body);
    sendSuccess(res, address, 'Address updated successfully');
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    await deleteAddress(authReq.user!.id, req.params.id);
    sendSuccess(res, null, 'Address deleted successfully');
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/default', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const address = await setDefault(authReq.user!.id, req.params.id);
    sendSuccess(res, address, 'Default address updated');
  } catch (error) {
    next(error);
  }
});

export default router;
