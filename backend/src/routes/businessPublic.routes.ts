import { Router, Request, Response, NextFunction } from 'express';
import { query } from '../config/database';
import { sendSuccess, sendError } from '../utils/response';

const router = Router();

// GET /api/businesses/public
// List active businesses (public, no auth required)
router.get(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // --------------------------------------------------
      // Pagination
      // --------------------------------------------------

      const requestedPage = Number(req.query.page);
      const requestedLimit = Number(req.query.limit);

      const page =
        Number.isInteger(requestedPage) && requestedPage > 0
          ? requestedPage
          : 1;

      // Keep limit between 1 and 100
      const limit =
        Number.isInteger(requestedLimit) &&
        requestedLimit > 0
          ? Math.min(requestedLimit, 100)
          : 20;

      const offset = (page - 1) * limit;

      // --------------------------------------------------
      // Filters
      // --------------------------------------------------

      const city =
        typeof req.query.city === 'string'
          ? req.query.city.trim()
          : '';

      const businessType =
        typeof req.query.business_type === 'string'
          ? req.query.business_type.trim()
          : '';

      const search =
        typeof req.query.search === 'string'
          ? req.query.search.trim()
          : '';

      // --------------------------------------------------
      // Base query
      // --------------------------------------------------

      let sql = `
        SELECT *
        FROM businesses
        WHERE status = ?
      `;

      const params: any[] = ['ACTIVE'];

      // --------------------------------------------------
      // City filter
      // --------------------------------------------------

      if (city) {
        sql += ' AND city = ?';
        params.push(city);
      }

      // --------------------------------------------------
      // Business type filter
      // --------------------------------------------------

      if (businessType) {
        sql += ' AND business_type = ?';
        params.push(businessType);
      }

      // --------------------------------------------------
      // Search filter
      // --------------------------------------------------

      if (search) {
        sql += `
          AND (
            name LIKE ?
            OR description LIKE ?
          )
        `;

        params.push(
          `%${search}%`,
          `%${search}%`
        );
      }

      // --------------------------------------------------
      // Total count
      // --------------------------------------------------

      const countSql = sql.replace(
        'SELECT *',
        'SELECT COUNT(*) AS total'
      );

      const countResult = await query<{ total: number }>(
        countSql,
        params
      );

      const total = Number(
        countResult.rows[0]?.total || 0
      );

      // --------------------------------------------------
      // IMPORTANT:
      // Do NOT use LIMIT ? OFFSET ? with this MySQL setup.
      //
      // limit and offset have already been validated
      // as integers above.
      // --------------------------------------------------

      sql += `
        ORDER BY created_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;

      const result = await query(sql, params);

      // --------------------------------------------------
      // Fetch images
      // --------------------------------------------------

      const businesses = [];

      for (const biz of result.rows) {
        const imgResult = await query(
          `
            SELECT *
            FROM business_images
            WHERE business_id = ?
            ORDER BY sort_order ASC
          `,
          [biz.id]
        );

        businesses.push({
          ...biz,
          images: imgResult.rows,
        });
      }

      // --------------------------------------------------
      // Response
      // --------------------------------------------------

      sendSuccess(
        res,
        {
          businesses,

          pagination: {
            total,
            page,
            limit,
            totalPages:
              limit > 0
                ? Math.ceil(total / limit)
                : 0,
          },
        },
        'Businesses fetched successfully'
      );
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/businesses/public/:id
// Get business details
router.get(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await query(
        `
          SELECT *
          FROM businesses
          WHERE id = ?
          AND status = ?
        `,
        [
          req.params.id,
          'ACTIVE',
        ]
      );

      if (result.rows.length === 0) {
        sendError(
          res,
          'Business not found',
          404
        );
        return;
      }

      const business = result.rows[0];

      // --------------------------------------------------
      // Get business images
      // --------------------------------------------------

      const imgResult = await query(
        `
          SELECT *
          FROM business_images
          WHERE business_id = ?
          ORDER BY sort_order ASC
        `,
        [business.id]
      );

      sendSuccess(
        res,
        {
          ...business,
          images: imgResult.rows,
        },
        'Business fetched successfully'
      );
    } catch (error) {
      next(error);
    }
  }
);

export default router;