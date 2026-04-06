import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** POST /auth/register */
  @Post('register')
  async register(
    @Body('email') email: string,
    @Body('password') password?: string,
    @Body('name') name?: string,
    @Body('dob') dob?: string,
    @Body('role') role?: string,
    @Body('provider') provider?: string,
  ) {
    // defaults
    return this.authService.register({ 
      email, 
      password, 
      name: name || 'User',
      dob,
      role: role || 'CANDIDATE',
      provider: provider || 'local'
    });
  }

  /** POST /auth/login */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body('email') email: string,
    @Body('password') password?: string,
  ) {
    return this.authService.login({ email, password });
  }

  /** POST /auth/google */
  @Post('google')
  @HttpCode(HttpStatus.OK)
  async googleLogin(
    @Body('accessToken') accessToken: string,
  ) {
    return this.authService.googleLogin(accessToken);
  }
}

