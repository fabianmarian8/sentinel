import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { PrismaService } from '../prisma/prisma.service';
import { AlertStatusFilter } from './dto/alert-filter.dto';
import { AlertSeverity } from '@prisma/client';

describe('AlertsService', () => {
  let service: AlertsService;
  let prisma: PrismaService;

  const mockPrismaService = {
    workspace: {
      findUnique: jest.fn(),
    },
    alert: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<AlertsService>(AlertsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findMany', () => {
    const userId = 'user-123';
    const workspaceId = 'workspace-123';

    it('should return alerts for workspace member', async () => {
      const mockWorkspace = {
        id: workspaceId,
        ownerId: 'other-user',
        members: [{ userId }],
      };

      const mockAlerts = [
        {
          id: 'alert-1',
          severity: AlertSeverity.critical,
          title: 'Test Alert',
          triggeredAt: new Date(),
        },
      ];

      mockPrismaService.workspace.findUnique.mockResolvedValue(mockWorkspace);
      mockPrismaService.alert.findMany.mockResolvedValue(mockAlerts);

      const result = await service.findMany(
        { workspaceId, status: AlertStatusFilter.OPEN },
        userId,
      );

      expect(result).toEqual({
        alerts: mockAlerts,
        count: 1,
      });
      expect(mockPrismaService.alert.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            rule: { source: { workspaceId } },
            resolvedAt: null,
            acknowledgedAt: null,
          }),
        }),
      );
    });

    it('should throw NotFoundException for non-existent workspace', async () => {
      mockPrismaService.workspace.findUnique.mockResolvedValue(null);

      await expect(
        service.findMany({ workspaceId }, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for non-member', async () => {
      const mockWorkspace = {
        id: workspaceId,
        ownerId: 'other-user',
        members: [],
      };

      mockPrismaService.workspace.findUnique.mockResolvedValue(mockWorkspace);

      await expect(
        service.findMany({ workspaceId }, userId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should filter by severity', async () => {
      const mockWorkspace = {
        id: workspaceId,
        ownerId: userId,
        members: [{ userId }],
      };

      mockPrismaService.workspace.findUnique.mockResolvedValue(mockWorkspace);
      mockPrismaService.alert.findMany.mockResolvedValue([]);

      await service.findMany(
        { workspaceId, severity: AlertSeverity.critical },
        userId,
      );

      expect(mockPrismaService.alert.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            severity: AlertSeverity.critical,
          }),
        }),
      );
    });

    it('should filter by status - acknowledged', async () => {
      const mockWorkspace = {
        id: workspaceId,
        ownerId: userId,
        members: [{ userId }],
      };

      mockPrismaService.workspace.findUnique.mockResolvedValue(mockWorkspace);
      mockPrismaService.alert.findMany.mockResolvedValue([]);

      await service.findMany(
        { workspaceId, status: AlertStatusFilter.ACKNOWLEDGED },
        userId,
      );

      expect(mockPrismaService.alert.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            acknowledgedAt: { not: null },
            resolvedAt: null,
          }),
        }),
      );
    });

    it('should filter by status - resolved', async () => {
      const mockWorkspace = {
        id: workspaceId,
        ownerId: userId,
        members: [{ userId }],
      };

      mockPrismaService.workspace.findUnique.mockResolvedValue(mockWorkspace);
      mockPrismaService.alert.findMany.mockResolvedValue([]);

      await service.findMany(
        { workspaceId, status: AlertStatusFilter.RESOLVED },
        userId,
      );

      expect(mockPrismaService.alert.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            resolvedAt: { not: null },
          }),
        }),
      );
    });
  });

  describe('acknowledge', () => {
    const userId = 'user-123';
    const alertId = 'alert-123';

    it('should acknowledge an alert', async () => {
      const mockAlert = {
        id: alertId,
        rule: {
          source: {
            workspaceId: 'workspace-123',
            workspace: { id: 'workspace-123', ownerId: userId, members: [] },
          },
        },
      };

      const mockUpdatedAlert = {
        ...mockAlert,
        acknowledgedAt: new Date(),
        acknowledgedBy: userId,
      };

      mockPrismaService.alert.findUnique.mockResolvedValue(mockAlert);
      mockPrismaService.workspace.findUnique.mockResolvedValue({
        id: 'workspace-123',
        ownerId: userId,
        members: [],
      });
      mockPrismaService.alert.update.mockResolvedValue(mockUpdatedAlert);

      const result = await service.acknowledge(alertId, userId);

      expect(result.acknowledgedBy).toBe(userId);
      expect(mockPrismaService.alert.update).toHaveBeenCalledWith({
        where: { id: alertId },
        data: {
          acknowledgedAt: expect.any(Date),
          acknowledgedBy: userId,
        },
      });
    });
  });

  describe('resolve', () => {
    const userId = 'user-123';
    const alertId = 'alert-123';

    it('should resolve an alert', async () => {
      const mockAlert = {
        id: alertId,
        rule: {
          source: {
            workspaceId: 'workspace-123',
            workspace: { id: 'workspace-123', ownerId: userId, members: [] },
          },
        },
      };

      const mockUpdatedAlert = {
        ...mockAlert,
        resolvedAt: new Date(),
      };

      mockPrismaService.alert.findUnique.mockResolvedValue(mockAlert);
      mockPrismaService.workspace.findUnique.mockResolvedValue({
        id: 'workspace-123',
        ownerId: userId,
        members: [],
      });
      mockPrismaService.alert.update.mockResolvedValue(mockUpdatedAlert);

      const result = await service.resolve(alertId, userId);

      expect(result.resolvedAt).toBeDefined();
      expect(mockPrismaService.alert.update).toHaveBeenCalledWith({
        where: { id: alertId },
        data: {
          resolvedAt: expect.any(Date),
        },
      });
    });
  });
});
