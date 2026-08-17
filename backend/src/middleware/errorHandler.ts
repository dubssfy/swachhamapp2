import { Request, Response, NextFunction } from 'express';
import { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';
import { logger } from '../utils/logger';
import { config } from '../config/env';

interface MySQLError extends Error {
  code?: string;
  errno?: number;
  sqlMessage?: string;
  sqlState?: string;
}

interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function errorHandler(
  err: AppError | MySQLError | JsonWebTokenError | Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const isProd = config.NODE_ENV === 'production';

  logger.error(`[ErrorHandler] ${req.method} ${req.path}`, {
    message: err.message,
    stack: isProd ? undefined : err.stack,
    code: (err as MySQLError).code,
  });

  // JWT errors
  if (err instanceof TokenExpiredError) {
    res.status(401).json({
      success: false,
      message: 'Token has expired, please log in again',
    });
    return;
  }

  if (err instanceof JsonWebTokenError) {
    res.status(401).json({
      success: false,
      message: 'Invalid token, please log in again',
    });
    return;
  }

  // MySQL errors
  const mysqlErr = err as MySQLError;
  
  // ER_DUP_ENTRY (1062)
  if (mysqlErr.errno === 1062) {
    res.status(409).json({
      success: false,
      message: 'A record with this value already exists',
      errors: isProd ? undefined : { detail: mysqlErr.sqlMessage },
    });
    return;
  }

  // ER_NO_REFERENCED_ROW_2 (1452) or ER_ROW_IS_REFERENCED_2 (1451)
  if (mysqlErr.errno === 1451 || mysqlErr.errno === 1452) {
    res.status(400).json({
      success: false,
      message: 'Referenced resource does not exist or is in use',
      errors: isProd ? undefined : { detail: mysqlErr.sqlMessage },
    });
    return;
  }

  // App-level operational errors
  const appErr = err as AppError;
  if (appErr.isOperational && appErr.statusCode) {
    res.status(appErr.statusCode).json({
      success: false,
      message: appErr.message,
    });
    return;
  }

  // Generic / unknown errors
  const statusCode = appErr.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: statusCode === 500 ? 'Internal server error' : err.message,
    ...(isProd ? {} : { stack: err.stack }),
  });
}

export { errorHandler };
