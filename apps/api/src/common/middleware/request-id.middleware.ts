import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { nanoid } from 'nanoid';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request & { requestId?: string }, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-request-id'];
    req.requestId = typeof incoming === 'string' && incoming.length > 0 ? incoming : nanoid();
    res.setHeader('x-request-id', req.requestId);
    next();
  }
}
