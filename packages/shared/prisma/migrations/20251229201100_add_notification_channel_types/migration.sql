-- AlterEnum
-- Add new notification channel types: slack_oauth, discord, push
ALTER TYPE "NotificationChannelType" ADD VALUE 'slack_oauth';
ALTER TYPE "NotificationChannelType" ADD VALUE 'discord';
ALTER TYPE "NotificationChannelType" ADD VALUE 'push';
