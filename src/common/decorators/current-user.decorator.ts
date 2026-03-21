import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * CurrentUser – extracts the authenticated user from the request object.
 * Usage: @CurrentUser() user: UserEntity
 *
 * Requires JwtAuthGuard (or equivalent) to attach `user` to the request first.
 */
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);
