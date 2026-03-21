import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Observable } from 'rxjs';

/**
 * JwtAuthGuard – placeholder for JWT-based authentication.
 * Replace with real JWT validation logic (e.g., using @nestjs/passport).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    // TODO: validate JWT from Authorization header
    return true;
  }
}
