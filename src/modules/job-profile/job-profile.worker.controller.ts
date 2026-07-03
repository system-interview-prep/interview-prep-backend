import { Body, Controller, Headers, Post } from '@nestjs/common';
import { JpStatusGateway } from './jp-status.gateway';

@Controller('internal/jp-events')
export class JobProfileWorkerController {
  constructor(private readonly jpGateway: JpStatusGateway) {}

  /**
   * Worker -> API to broadcast status to Socket.IO.
   * Header: x-worker-secret: <WORKER_SECRET>
   */
  @Post('status')
  async broadcastStatus(
    @Headers('x-worker-secret') secret: string,
    @Body() body: { uploadId: string; payload: Record<string, any> },
  ) {
    const expected = process.env.WORKER_SECRET || '';
    if (!expected || secret !== expected) {
      return { ok: false };
    }
    if (body?.uploadId) {
      this.jpGateway.emitStatus(body.uploadId, body.payload || {});
    }
    return { ok: true };
  }
}

