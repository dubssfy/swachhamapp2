import { Router } from 'express';
import { getServices, getServiceById } from '../services/service.service';
import { sendSuccess } from '../utils/response';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const services = await getServices({ page, limit, search: req.query.search as string, categoryId: req.query.category_id as string });
    sendSuccess(res, services, 'Services fetched successfully');
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const service = await getServiceById(req.params.id);
    sendSuccess(res, service, 'Service fetched successfully');
  } catch (error) {
    next(error);
  }
});

export default router;
