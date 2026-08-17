import { Router, Request, Response, NextFunction } from 'express';
import { getBusiness, createBusiness, updateBusiness, addBusinessImage, getBusinessImages, deleteBusinessImage } from '../services/business.service';
import { sendSuccess } from '../utils/response';
import { authenticate, AuthenticatedRequest, requireRole } from '../middleware/auth';

const router = Router();
router.use(authenticate);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const business = await getBusiness(authReq.user!.id);
    sendSuccess(res, business, 'Business fetched successfully');
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const business = await createBusiness(authReq.user!.id, req.body);
    sendSuccess(res, business, 'Business created successfully', 201);
  } catch (error) {
    next(error);
  }
});

router.put('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const business = await updateBusiness(authReq.user!.id, req.body);
    sendSuccess(res, business, 'Business updated successfully');
  } catch (error) {
    next(error);
  }
});

router.get('/images', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const business = await getBusiness(authReq.user!.id);
    if (!business) throw new Error('Business not found');
    
    const images = await getBusinessImages(business.id);
    sendSuccess(res, images, 'Business images fetched successfully');
  } catch (error) {
    next(error);
  }
});

router.post('/images', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const business = await getBusiness(authReq.user!.id);
    if (!business) throw new Error('Business not found');
    
    const { image_url, is_primary } = req.body;
    const image = await addBusinessImage(business.id, image_url, is_primary);
    sendSuccess(res, image, 'Business image added successfully', 201);
  } catch (error) {
    next(error);
  }
});

router.delete('/images/:imageId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const business = await getBusiness(authReq.user!.id);
    if (!business) throw new Error('Business not found');
    
    await deleteBusinessImage(req.params.imageId, business.id);
    sendSuccess(res, null, 'Business image deleted successfully');
  } catch (error) {
    next(error);
  }
});

export default router;
