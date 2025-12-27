import { Test, TestingModule } from '@nestjs/testing';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { AlertStatusFilter } from './dto/alert-filter.dto';
import { AlertSeverity } from '@prisma/client';

describe('AlertsController', () => {
  let controller: AlertsController;
  let service: AlertsService;

  const mockAlertsService = {
    findMany: jest.fn(),
    findOne: jest.fn(),
    acknowledge: jest.fn(),
    resolve: jest.fn(),
    findRecent: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AlertsController],
      providers: [
        {
          provide: AlertsService,
          useValue: mockAlertsService,
        },
      ],
    }).compile();

    controller = module.get<AlertsController>(AlertsController);
    service = module.get<AlertsService>(AlertsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return filtered alerts', async () => {
      const userId = 'user-123';
      const workspaceId = 'workspace-123';
      const filters = {
        workspaceId,
        status: AlertStatusFilter.OPEN,
        severity: AlertSeverity.critical,
      };

      const expectedResult = {
        alerts: [
          {
            id: 'alert-1',
            severity: AlertSeverity.critical,
            title: 'Test Alert',
            triggeredAt: new Date(),
          },
        ],
        count: 1,
      };

      mockAlertsService.findMany.mockResolvedValue(expectedResult);

      const result = await controller.findAll(filters, userId);

      expect(result).toEqual(expectedResult);
      expect(mockAlertsService.findMany).toHaveBeenCalledWith(filters, userId);
    });
  });

  describe('findOne', () => {
    it('should return a single alert', async () => {
      const userId = 'user-123';
      const alertId = 'alert-123';
      const expectedAlert = {
        id: alertId,
        severity: AlertSeverity.critical,
        title: 'Test Alert',
      };

      mockAlertsService.findOne.mockResolvedValue(expectedAlert);

      const result = await controller.findOne(alertId, userId);

      expect(result).toEqual(expectedAlert);
      expect(mockAlertsService.findOne).toHaveBeenCalledWith(alertId, userId);
    });
  });

  describe('acknowledge', () => {
    it('should acknowledge an alert', async () => {
      const userId = 'user-123';
      const alertId = 'alert-123';
      const expectedAlert = {
        id: alertId,
        acknowledgedAt: new Date(),
        acknowledgedBy: userId,
      };

      mockAlertsService.acknowledge.mockResolvedValue(expectedAlert);

      const result = await controller.acknowledge(alertId, userId);

      expect(result).toEqual(expectedAlert);
      expect(mockAlertsService.acknowledge).toHaveBeenCalledWith(
        alertId,
        userId,
      );
    });
  });

  describe('resolve', () => {
    it('should resolve an alert', async () => {
      const userId = 'user-123';
      const alertId = 'alert-123';
      const expectedAlert = {
        id: alertId,
        resolvedAt: new Date(),
      };

      mockAlertsService.resolve.mockResolvedValue(expectedAlert);

      const result = await controller.resolve(alertId, userId);

      expect(result).toEqual(expectedAlert);
      expect(mockAlertsService.resolve).toHaveBeenCalledWith(alertId, userId);
    });
  });

  describe('stream', () => {
    it('should return an observable for SSE', (done) => {
      const userId = 'user-123';
      const workspaceId = 'workspace-123';

      mockAlertsService.findRecent.mockResolvedValue([
        {
          id: 'alert-1',
          severity: AlertSeverity.critical,
          title: 'Test Alert',
        },
      ]);

      const stream$ = controller.stream(userId, workspaceId);

      // Subscribe and verify first emission
      const subscription = stream$.subscribe({
        next: (event) => {
          expect(event).toHaveProperty('data');
          expect(typeof event.data).toBe('string');

          const parsedData = JSON.parse(event.data as string);
          expect(Array.isArray(parsedData)).toBe(true);

          subscription.unsubscribe();
          done();
        },
        error: done,
      });
    });
  });
});
