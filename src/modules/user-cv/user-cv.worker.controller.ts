import { Body, Controller, Headers, Post } from '@nestjs/common';
import { CvStatusGateway } from './cv-status.gateway';

@Controller('internal/cv-events')
export class UserCvWorkerController {
  constructor(private readonly cvGateway: CvStatusGateway) {}

  /**
   * Worker -> API to broadcast status to Socket.IO.
   * Header: x-worker-secret: <WORKER_SECRET>
   */
  @Post('status')
  async broadcastStatus(
    @Headers('x-worker-secret') secret: string,
    @Body() body: { cvId: string; payload: Record<string, any> },
  ) {
    const expected = process.env.WORKER_SECRET || '';
    if (!expected || secret !== expected) {
      return { ok: false };
    }
    if (body?.cvId) {
      this.cvGateway.emitStatus(body.cvId, body.payload || {});
    }
    return { ok: true };
  }
}

