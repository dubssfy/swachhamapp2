// Plain Error subclass carrying an HTTP status code so errorHandler can
// return the real message instead of masking it as a generic 500.
class AppError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

export { AppError };
