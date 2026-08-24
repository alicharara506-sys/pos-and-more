import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * Normalizes every error response to a stable shape and never leaks internal
 * error details (stack traces, DB errors) to the client. Every response
 * includes the request ID (see request-id.middleware) so a report from a
 * user can be correlated with server logs.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<{ requestId?: string }>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = isHttpException ? exception.getResponse() : undefined;

    const message =
      typeof body === 'object' && body !== null && 'message' in body
        ? (body as { message: unknown }).message
        : isHttpException
          ? exception.message
          : 'Internal server error';

    if (!isHttpException) {
      this.logger.error(exception instanceof Error ? exception.stack : exception);
    }

    response.status(status).json({
      statusCode: status,
      message,
      requestId: request.requestId,
      timestamp: new Date().toISOString(),
    });
  }
}
