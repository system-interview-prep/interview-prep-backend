import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';
import { JwtService } from '@nestjs/jwt';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import axios from 'axios';

jest.mock('bcrypt');
jest.mock('axios');

describe('AuthService', () => {
  let authService: AuthService;
  let userService: jest.Mocked<UserService>;
  let jwtService: jest.Mocked<JwtService>;

  const mockUser = {
    id: 'user-uuid-123',
    email: 'test@example.com',
    password: '$2b$10$hashedpassword',
    name: 'Test User',
    role: 'CANDIDATE',
    provider: 'local',
  };

  beforeEach(async () => {
    const mockUserService = {
      findByEmail: jest.fn(),
      createUser: jest.fn(),
    };

    const mockJwtService = {
      signAsync: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserService, useValue: mockUserService },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    userService = module.get(UserService);
    jwtService = module.get(JwtService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('TC-AUTH-REG-01: Registered user successfully with valid local data', async () => {
      userService.findByEmail.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('$2b$10$hashedpassword');
      userService.createUser.mockResolvedValue(mockUser as any);

      const dto = { email: 'test@example.com', password: 'password123', name: 'Test User' };
      const result = await authService.register(dto);

      expect(userService.findByEmail).toHaveBeenCalledWith('test@example.com');
      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 10);
      expect(userService.createUser).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: '$2b$10$hashedpassword',
        name: 'Test User',
      });
      expect(result).toEqual({ message: 'User registered successfully' });
    });

    it('TC-AUTH-REG-02: Should throw BadRequestException if email already exists', async () => {
      userService.findByEmail.mockResolvedValue(mockUser as any);

      const dto = { email: 'test@example.com', password: 'password123', name: 'Test User' };
      await expect(authService.register(dto)).rejects.toThrow(BadRequestException);

      expect(userService.createUser).not.toHaveBeenCalled();
    });

    it('TC-AUTH-REG-03: Register via Google provider returns access token', async () => {
      userService.findByEmail.mockResolvedValue(null);
      userService.createUser.mockResolvedValue({ ...mockUser, provider: 'google' } as any);
      jwtService.signAsync.mockResolvedValue('mock-jwt-token');

      const dto = { email: 'google@example.com', name: 'Google User', provider: 'google' };
      const result = await authService.register(dto);

      expect(jwtService.signAsync).toHaveBeenCalledWith({
        sub: 'user-uuid-123',
        email: 'test@example.com',
        role: 'CANDIDATE',
      });
      expect(result).toEqual({
        message: 'Google login/register success',
        access_token: 'mock-jwt-token',
      });
    });
  });

  describe('login', () => {
    it('TC-AUTH-LOG-01: Login successfully with correct credentials', async () => {
      userService.findByEmail.mockResolvedValue(mockUser as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      jwtService.signAsync.mockResolvedValue('mock-jwt-token');

      const result = await authService.login({ email: 'test@example.com', password: 'password123' });

      expect(bcrypt.compare).toHaveBeenCalledWith('password123', mockUser.password);
      expect(result).toEqual({
        access_token: 'mock-jwt-token',
        user: {
          id: mockUser.id,
          email: mockUser.email,
          name: mockUser.name,
          role: mockUser.role,
        },
      });
    });

    it('TC-AUTH-LOG-02: Throw UnauthorizedException if user not found', async () => {
      userService.findByEmail.mockResolvedValue(null);

      await expect(authService.login({ email: 'nonexistent@example.com', password: 'password123' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('TC-AUTH-LOG-03: Throw UnauthorizedException if password is wrong', async () => {
      userService.findByEmail.mockResolvedValue(mockUser as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(authService.login({ email: 'test@example.com', password: 'wrongpassword' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('TC-AUTH-LOG-04: Throw UnauthorizedException if password is missing for local user', async () => {
      userService.findByEmail.mockResolvedValue(mockUser as any);

      await expect(authService.login({ email: 'test@example.com' })).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('googleLogin', () => {
    it('TC-AUTH-GGL-01: Return access token for existing Google user', async () => {
      const mockGoogleProfile = { email: 'google@example.com', name: 'Google User' };
      (axios.get as jest.Mock).mockResolvedValue({ data: mockGoogleProfile });
      userService.findByEmail.mockResolvedValue({ ...mockUser, email: 'google@example.com' } as any);
      jwtService.signAsync.mockResolvedValue('google-jwt-token');

      const result = await authService.googleLogin('valid-google-token');

      expect(axios.get).toHaveBeenCalledWith('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: 'Bearer valid-google-token' },
      });
      expect(result.access_token).toBe('google-jwt-token');
    });

    it('TC-AUTH-GGL-02: Throw UnauthorizedException for invalid Google access token', async () => {
      (axios.get as jest.Mock).mockRejectedValue(new Error('Invalid token'));

      await expect(authService.googleLogin('invalid-token')).rejects.toThrow(UnauthorizedException);
    });
  });
});
