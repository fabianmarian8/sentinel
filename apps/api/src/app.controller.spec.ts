import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { PrismaService } from './prisma/prisma.service';

describe('AppController', () => {
  let appController: AppController;
  let prismaService: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: jest.fn(),
          },
        },
      ],
    }).compile();

    appController = module.get<AppController>(AppController);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  describe('root', () => {
    it('should return API information', () => {
      const result = appController.root();
      expect(result).toHaveProperty('name', 'Sentinel API');
      expect(result).toHaveProperty('version', '0.0.1');
      expect(result).toHaveProperty('description');
      expect(result).toHaveProperty('documentation', '/api/docs');
    });
  });

  describe('health', () => {
    it('should return ok status when database is connected', async () => {
      jest.spyOn(prismaService, '$queryRaw').mockResolvedValue([{ '?column?': 1 }]);

      const result = await appController.health();
      expect(result).toHaveProperty('status', 'ok');
      expect(result).toHaveProperty('database', 'connected');
      expect(result).toHaveProperty('timestamp');
    });

    it('should return error status when database is disconnected', async () => {
      jest.spyOn(prismaService, '$queryRaw').mockRejectedValue(new Error('Connection failed'));

      const result = await appController.health();
      expect(result).toHaveProperty('status', 'error');
      expect(result).toHaveProperty('database', 'disconnected');
      expect(result).toHaveProperty('timestamp');
    });
  });
});
