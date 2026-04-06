import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { UserService } from '../user/user.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import axios from 'axios';

interface RegisterDto {
  email: string;
  password?: string;
  name: string;
  dob?: string;
  role?: string;
  provider?: string;
}

interface LoginDto {
  email: string;
  password?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private userService: UserService,
    private jwtService: JwtService
  ) {}

  async register(dto: RegisterDto): Promise<{ message: string; access_token?: string }> {
    const existing = await this.userService.findByEmail(dto.email);
    if (existing) {
      throw new BadRequestException('Email is already registered');
    }

    let hashedPassword = null;
    if (dto.password) {
      hashedPassword = await bcrypt.hash(dto.password, 10);
    }

    const newUser = await this.userService.createUser({
      ...dto,
      password: hashedPassword,
    });

    if (dto.provider === 'google') {
      const payload = { sub: newUser.id, email: newUser.email, role: newUser.role };
      return { 
        message: 'Google login/register success',
        access_token: await this.jwtService.signAsync(payload)
      };
    }

    return { message: 'User registered successfully' };
  }

  async login(dto: LoginDto): Promise<{ access_token: string; user: any }> {
    const user = await this.userService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.provider === 'local') {
      if (!dto.password) {
        throw new UnauthorizedException('Password is required');
      }
      const isPasswordValid = await bcrypt.compare(dto.password, user.password);
      if (!isPasswordValid) {
        throw new UnauthorizedException('Invalid credentials');
      }
    }

    const payload = { sub: user.id, email: user.email, role: user.role };
    return {
      access_token: await this.jwtService.signAsync(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    };
  }

  async googleLogin(accessToken: string): Promise<{ access_token: string; user: any }> {
    try {
      const response = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      
      const profile = response.data;
      if (!profile.email) {
        throw new BadRequestException('Google account does not have an email');
      }

      const existingUser = await this.userService.findByEmail(profile.email);
      
      if (existingUser) {
        const payload = { sub: existingUser.id, email: existingUser.email, role: existingUser.role };
        return {
          access_token: await this.jwtService.signAsync(payload),
          user: existingUser
        };
      }

      // Auto register
      const newUserRes = await this.register({
        email: profile.email,
        name: profile.name || 'Google User',
        provider: 'google',
        role: 'CANDIDATE',
      });

      const registeredUser = await this.userService.findByEmail(profile.email);
      return {
        access_token: newUserRes.access_token || '',
        user: registeredUser
      };
    } catch (error) {
      throw new UnauthorizedException('Invalid Google token');
    }
  }
}
