import { Response } from 'express';

interface SuccessResponse<T> {
  success: true;
  message: string;
  data: T;
}

interface ErrorResponse {
  success: false;
  message: string;
  errors?: unknown;
}

interface PaginatedResponse<T> {
  success: true;
  message: string;
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

function sendSuccess<T>(
  res: Response,
  data: T,
  message: string = 'Success',
  statusCode: number = 200
): Response<SuccessResponse<T>> {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
}

function sendError(
  res: Response,
  message: string = 'An error occurred',
  statusCode: number = 400,
  errors?: unknown
): Response<ErrorResponse> {
  const body: ErrorResponse = {
    success: false,
    message,
  };
  if (errors !== undefined) {
    body.errors = errors;
  }
  return res.status(statusCode).json(body);
}

function sendPaginated<T>(
  res: Response,
  data: T[],
  total: number,
  page: number,
  limit: number,
  message: string = 'Success'
): Response<PaginatedResponse<T>> {
  const totalPages = Math.ceil(total / limit);
  return res.status(200).json({
    success: true,
    message,
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  });
}

export { sendSuccess, sendError, sendPaginated };
export type { SuccessResponse, ErrorResponse, PaginatedResponse };
