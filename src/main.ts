
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';
import { corsOrigins } from './config/cors.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  const bootLog = new Logger('HTTP');
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (req.method === 'POST' && req.url?.includes('/user/profile/picture')) {
      bootLog.log(`${req.method} ${req.originalUrl ?? req.url} (Authorization: ${req.headers.authorization ? 'Bearer ***' : 'MISSING'})`);
    }
    next();
  });

  await app.listen(5000);
}

bootstrap();
