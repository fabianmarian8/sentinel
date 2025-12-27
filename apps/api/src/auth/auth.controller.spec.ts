import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

// Mock bcrypt to avoid native module issues in tests
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
  compare: jest.fn().mockResolvedValue(true),
}));

describe('AuthController', () => {
  let controller: AuthController;
  let authService: AuthService;

  const mockAuthResponse = {
    accessToken: 'mock-jwt-token',
    user: {
      id: 'test-user-id',
      email: 'test@example.com',
    },
  };

  const mockUser = {
    id: 'test-user-id',
    email: 'test@example.com',
    createdAt: new Date(),
    lastLoginAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            register: jest.fn(),
            login: jest.fn(),
            validateUser: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    it('should register a new user', async () => {
      jest.spyOn(authService, 'register').mockResolvedValue(mockAuthResponse);

      const result = await controller.register({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result).toEqual(mockAuthResponse);
      expect(authService.register).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
      });
    });
  });

  describe('login', () => {
    it('should login a user', async () => {
      jest.spyOn(authService, 'login').mockResolvedValue(mockAuthResponse);

      const result = await controller.login({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result).toEqual(mockAuthResponse);
      expect(authService.login).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
      });
    });
  });

  describe('getMe', () => {
    it('should return current user', async () => {
      const req = { user: mockUser };

      const result = await controller.getMe(req);

      expect(result).toEqual(mockUser);
    });
  });
});
