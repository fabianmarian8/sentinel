import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

// Mock bcrypt
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
  compare: jest.fn().mockResolvedValue(true),
}));

const bcrypt = require('bcryptjs');

describe('AuthService', () => {
  let service: AuthService;
  let prismaService: PrismaService;

  const mockUser = {
    id: 'test-user-id',
    email: 'test@example.com',
    passwordHash: 'hashed-password',
    createdAt: new Date(),
    lastLoginAt: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
            },
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('mock-jwt-token'),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  describe('register', () => {
    it('should successfully register a new user', async () => {
      jest.spyOn(prismaService.user, 'findUnique').mockResolvedValue(null);
      jest.spyOn(prismaService.user, 'create').mockResolvedValue({
        id: mockUser.id,
        email: mockUser.email,
        passwordHash: 'new-hashed-password',
        createdAt: new Date(),
        lastLoginAt: null,
      });

      const result = await service.register({
        email: 'newuser@example.com',
        password: 'password123',
      });

      expect(result).toHaveProperty('accessToken', 'mock-jwt-token');
      expect(result).toHaveProperty('user');
      expect(result.user).toHaveProperty('id', mockUser.id);
      expect(result.user).toHaveProperty('email', mockUser.email);
      expect(prismaService.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'newuser@example.com' },
      });
    });

    it('should throw ConflictException if user already exists', async () => {
      jest.spyOn(prismaService.user, 'findUnique').mockResolvedValue(mockUser);

      await expect(
        service.register({
          email: mockUser.email,
          password: 'password123',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('should successfully login with valid credentials', async () => {
      jest.spyOn(prismaService.user, 'findUnique').mockResolvedValue({
        ...mockUser,
        passwordHash: 'hashed-password',
      });
      jest.spyOn(prismaService.user, 'update').mockResolvedValue(mockUser);
      bcrypt.compare.mockResolvedValue(true);

      const result = await service.login({
        email: mockUser.email,
        password: 'password123',
      });

      expect(result).toHaveProperty('accessToken', 'mock-jwt-token');
      expect(result).toHaveProperty('user');
      expect(result.user).toHaveProperty('id', mockUser.id);
      expect(result.user).toHaveProperty('email', mockUser.email);
      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        data: { lastLoginAt: expect.any(Date) },
      });
    });

    it('should throw UnauthorizedException if user not found', async () => {
      jest.spyOn(prismaService.user, 'findUnique').mockResolvedValue(null);

      await expect(
        service.login({
          email: 'nonexistent@example.com',
          password: 'password123',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if password is invalid', async () => {
      jest.spyOn(prismaService.user, 'findUnique').mockResolvedValue(mockUser);
      bcrypt.compare.mockResolvedValue(false);

      await expect(
        service.login({
          email: mockUser.email,
          password: 'wrongpassword',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('validateUser', () => {
    it('should return user if found', async () => {
      jest.spyOn(prismaService.user, 'findUnique').mockResolvedValue(mockUser);

      const result = await service.validateUser(mockUser.id);

      expect(result).toEqual(mockUser);
      expect(prismaService.user.findUnique).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        select: {
          id: true,
          email: true,
          createdAt: true,
          lastLoginAt: true,
        },
      });
    });

    it('should throw UnauthorizedException if user not found', async () => {
      jest.spyOn(prismaService.user, 'findUnique').mockResolvedValue(null);

      await expect(service.validateUser('invalid-id')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
