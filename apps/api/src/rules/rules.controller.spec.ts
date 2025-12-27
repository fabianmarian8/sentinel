import { Test, TestingModule } from '@nestjs/testing';
import { RulesController } from './rules.controller';
import { RulesService } from './rules.service';
import { PrismaService } from '../prisma/prisma.service';

describe('RulesController', () => {
  let controller: RulesController;
  let service: RulesService;

  const mockRulesService = {
    findByWorkspace: jest.fn(),
    findBySource: jest.fn(),
    create: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
  };

  const mockPrismaService = {
    rule: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    ruleState: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RulesController],
      providers: [
        {
          provide: RulesService,
          useValue: mockRulesService,
        },
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    controller = module.get<RulesController>(RulesController);
    service = module.get<RulesService>(RulesService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('should call findByWorkspace when workspaceId is provided', async () => {
      const workspaceId = 'workspace-123';
      const userId = 'user-123';
      const req = { user: { id: userId } };

      await controller.findAll(workspaceId, undefined, req);

      expect(service.findByWorkspace).toHaveBeenCalledWith(workspaceId, userId);
    });

    it('should call findBySource when sourceId is provided', async () => {
      const sourceId = 'source-123';
      const userId = 'user-123';
      const req = { user: { id: userId } };

      await controller.findAll(undefined, sourceId, req);

      expect(service.findBySource).toHaveBeenCalledWith(sourceId, userId);
    });

    it('should throw error when neither workspaceId nor sourceId is provided', async () => {
      const req = { user: { id: 'user-123' } };

      await expect(
        controller.findAll(undefined, undefined, req),
      ).rejects.toThrow('Must provide either workspaceId or sourceId');
    });
  });

  describe('create', () => {
    it('should create a new rule', async () => {
      const dto = {
        sourceId: 'source-123',
        name: 'Test Rule',
        ruleType: 'price' as any,
        extraction: {} as any,
        normalization: {} as any,
        schedule: {} as any,
        alertPolicy: {} as any,
      };
      const req = { user: { id: 'user-123' } };

      await controller.create(dto, req);

      expect(service.create).toHaveBeenCalledWith(req.user.id, dto);
    });
  });

  describe('findOne', () => {
    it('should get a rule by id', async () => {
      const ruleId = 'rule-123';
      const req = { user: { id: 'user-123' } };

      await controller.findOne(ruleId, req);

      expect(service.findOne).toHaveBeenCalledWith(ruleId, req.user.id);
    });
  });

  describe('update', () => {
    it('should update a rule', async () => {
      const ruleId = 'rule-123';
      const dto = { name: 'Updated Rule' };
      const req = { user: { id: 'user-123' } };

      await controller.update(ruleId, dto, req);

      expect(service.update).toHaveBeenCalledWith(ruleId, req.user.id, dto);
    });
  });

  describe('remove', () => {
    it('should delete a rule', async () => {
      const ruleId = 'rule-123';
      const req = { user: { id: 'user-123' } };

      await controller.remove(ruleId, req);

      expect(service.remove).toHaveBeenCalledWith(ruleId, req.user.id);
    });
  });

  describe('pause', () => {
    it('should pause a rule', async () => {
      const ruleId = 'rule-123';
      const req = { user: { id: 'user-123' } };

      await controller.pause(ruleId, req);

      expect(service.pause).toHaveBeenCalledWith(ruleId, req.user.id);
    });
  });

  describe('resume', () => {
    it('should resume a rule', async () => {
      const ruleId = 'rule-123';
      const req = { user: { id: 'user-123' } };

      await controller.resume(ruleId, req);

      expect(service.resume).toHaveBeenCalledWith(ruleId, req.user.id);
    });
  });
});
