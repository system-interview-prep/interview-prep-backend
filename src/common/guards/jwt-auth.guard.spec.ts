import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let jwtService: jest.Mocked<JwtService>;

  beforeEach(() => {
    jwtService = {
      verifyAsync: jest.fn(),
    } as any;
    guard = new JwtAuthGuard(jwtService);
  });

  const createMockContext = (authHeader?: string): ExecutionContext => {
    const mockRequest = {
      headers: {
        authorization: authHeader,
      },
    };

    return {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as any;
  };

  it('TC-GUARD-01: Allow access and attach payload for valid Bearer token', async () => {
    const mockPayload = { sub: 'user-123', email: 'test@example.com', role: 'CANDIDATE' };
    jwtService.verifyAsync.mockResolvedValue(mockPayload);

    const context = createMockContext('Bearer valid-jwt-token');
    const canActivate = await guard.canActivate(context);

    expect(canActivate).toBe(true);
    expect(jwtService.verifyAsync).toHaveBeenCalledWith('valid-jwt-token', expect.any(Object));
    const req = context.switchToHttp().getRequest();
    expect(req.user).toEqual(mockPayload);
  });

  it('TC-GUARD-02: Throw UnauthorizedException if Authorization header is missing', async () => {
    const context = createMockContext(undefined);
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('TC-GUARD-03: Throw UnauthorizedException if scheme is not Bearer', async () => {
    const context = createMockContext('Basic token123');
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('TC-GUARD-04: Throw UnauthorizedException if token verification fails (expired/invalid)', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));
    const context = createMockContext('Bearer expired-jwt-token');

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });
});
