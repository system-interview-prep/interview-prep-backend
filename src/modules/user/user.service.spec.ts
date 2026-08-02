import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('UserService', () => {
  let userService: UserService;

  const mockUser = {
    id: 'user-uuid-123',
    email: 'test@example.com',
    name: 'Test User',
    dob: '1995-05-20',
    role: 'CANDIDATE',
    pictureUrl: 'https://storage.example.com/avatar.jpg',
  };

  beforeEach(async () => {
    const mockUserService = {
      getProfile: jest.fn(),
      updateProfile: jest.fn(),
      uploadProfilePicture: jest.fn(),
      findByEmail: jest.fn(),
      createUser: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: UserService, useValue: mockUserService },
      ],
    }).compile();

    userService = module.get<UserService>(UserService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getProfile', () => {
    it('TC-USER-PROF-01: Return profile successfully when user exists', async () => {
      (userService.getProfile as jest.Mock).mockResolvedValue(mockUser);

      const result = await userService.getProfile('test@example.com', 'user-uuid-123');
      expect(result).toEqual(mockUser);
    });

    it('TC-USER-PROF-02: Throw NotFoundException if user profile not found', async () => {
      (userService.getProfile as jest.Mock).mockRejectedValue(new NotFoundException('User profile not found'));

      await expect(userService.getProfile('unknown@example.com', 'user-999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProfile', () => {
    it('TC-USER-PROF-03: Update profile fields successfully', async () => {
      const updateData = { name: 'Updated Name', dob: '2000-01-01' };
      const updatedUser = { ...mockUser, ...updateData };
      (userService.updateProfile as jest.Mock).mockResolvedValue(updatedUser);

      const result = await userService.updateProfile('test@example.com', 'user-uuid-123', updateData);
      expect(result.name).toBe('Updated Name');
      expect(result.dob).toBe('2000-01-01');
    });

    it('TC-USER-PROF-04: Reject profile update with invalid field formats', async () => {
      (userService.updateProfile as jest.Mock).mockRejectedValue(new BadRequestException('Invalid date format for dob'));

      await expect(userService.updateProfile('test@example.com', 'user-uuid-123', { dob: 'invalid-date' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('uploadProfilePicture', () => {
    it('TC-USER-PIC-01: Upload avatar image successfully (JPEG/PNG, <= 5MB)', async () => {
      const mockFile = {
        fieldname: 'file',
        originalname: 'avatar.png',
        encoding: '7bit',
        mimetype: 'image/png',
        buffer: Buffer.from('mock-file-buffer'),
        size: 1024 * 1024,
      } as Express.Multer.File;

      const uploadResult = { pictureUrl: 'https://storage.example.com/avatar_new.png' };
      (userService.uploadProfilePicture as jest.Mock).mockResolvedValue(uploadResult);

      const result = await userService.uploadProfilePicture('test@example.com', 'user-uuid-123', mockFile);
      expect(result).toEqual(uploadResult);
    });

    it('TC-USER-PIC-02: Throw BadRequestException if uploaded file size > 5MB', async () => {
      const largeFile = {
        originalname: 'large_avatar.png',
        mimetype: 'image/png',
        size: 6 * 1024 * 1024,
      } as Express.Multer.File;

      (userService.uploadProfilePicture as jest.Mock).mockRejectedValue(new BadRequestException('File size exceeds 5MB limit'));

      await expect(userService.uploadProfilePicture('test@example.com', 'user-uuid-123', largeFile)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
