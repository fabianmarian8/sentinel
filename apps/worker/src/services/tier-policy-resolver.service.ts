/**
 * Tier Policy Resolver Service
 *
 * Resolves FetchProfile.domainTier + tierPolicyOverrides into concrete TierPolicy.
 *
 * Resolution order (highest priority last):
 * 1. Tier defaults (from TIER_DEFAULTS)
 * 2. Legacy nullable fields (preferredProvider, geoCountry) - for backward compat
 * 3. Explicit overrides from tierPolicyOverrides JSONB
 */

import { Injectable, Logger } from '@nestjs/common';
import { FetchProfile, DomainTier } from '@prisma/client';
import {
  TierPolicy,
  TierPolicyOverrides,
  TIER_DEFAULTS,
} from '../types/tier-policy';

@Injectable()
export class TierPolicyResolverService {
  private readonly logger = new Logger(TierPolicyResolverService.name);

  /**
   * Resolve a FetchProfile into a concrete TierPolicy
   *
   * @param profile - FetchProfile with domainTier and optional overrides
   * @returns Resolved TierPolicy with all fields defined
   */
  resolveTierPolicy(profile: FetchProfile): TierPolicy {
    const tier = profile.domainTier ?? 'tier_a';

    // 1. Start with tier defaults
    const tierDefault = TIER_DEFAULTS[tier] ?? TIER_DEFAULTS.tier_a;
    const base: TierPolicy = {
      preferredProvider: tierDefault.preferredProvider,
      disabledProviders: [...tierDefault.disabledProviders],
      stopAfterPreferredFailure: tierDefault.stopAfterPreferredFailure,
      sloTarget: tierDefault.sloTarget,
      allowPaid: tierDefault.allowPaid,
      geoCountry: undefined,
      timeoutMs: tierDefault.timeoutMs,
    };

    // 2. Overlay legacy nullable fields (backward compatibility)
    // These are only applied if they have non-default values
    if (profile.preferredProvider !== null) {
      base.preferredProvider = profile.preferredProvider;
      this.logger.debug(
        `Applying legacy preferredProvider: ${profile.preferredProvider}`,
      );
    }

    if (profile.geoCountry !== null) {
      base.geoCountry = profile.geoCountry;
      this.logger.debug(`Applying legacy geoCountry: ${profile.geoCountry}`);
    }

    // 3. Overlay explicit overrides from JSONB (highest priority)
    if (profile.tierPolicyOverrides) {
      const overrides = profile.tierPolicyOverrides as TierPolicyOverrides;
      this.applyOverrides(base, overrides);
    }

    // 4. Tier drift detection - warn about config inconsistencies
    this.detectTierDrift(profile, tier, base);

    this.logger.debug(
      `Resolved policy for tier ${tier}: preferredProvider=${base.preferredProvider}, ` +
        `disabledProviders=[${base.disabledProviders.join(',')}], ` +
        `stopAfterPreferred=${base.stopAfterPreferredFailure}, ` +
        `timeoutMs=${base.timeoutMs}, sloTarget=${base.sloTarget}`,
    );

    return base;
  }

  /**
   * Detect tier configuration drift/inconsistencies
   *
   * Warns about:
   * - tier_a with paid config (preferredProvider or stopAfterPreferredFailure)
   * - tier_b/c with allowPaid=false override (contradiction)
   */
  private detectTierDrift(profile: FetchProfile, tier: DomainTier, resolved: TierPolicy): void {
    const profileId = profile.id;

    // Case 1: tier_a but has paid configuration
    // This means the profile was likely used for paid-first but tier wasn't upgraded
    if (tier === 'tier_a' || tier === 'unknown') {
      const hasPaidConfig = profile.preferredProvider !== null ||
                            profile.stopAfterPreferredFailure === true;
      if (hasPaidConfig) {
        this.logger.warn(
          `[TIER_DRIFT] Profile ${profileId}: tier=${tier} but has paid config ` +
          `(preferredProvider=${profile.preferredProvider}, stopAfterPreferred=${profile.stopAfterPreferredFailure}). ` +
          `Consider upgrading to tier_b. Resolved allowPaid=${resolved.allowPaid}`,
        );
      }
    }

    // Case 2: tier_b/c but allowPaid disabled via override (contradiction)
    if ((tier === 'tier_b' || tier === 'tier_c') && !resolved.allowPaid) {
      this.logger.warn(
        `[TIER_DRIFT] Profile ${profileId}: tier=${tier} (paid tier) but allowPaid=false. ` +
        `This is a configuration contradiction - paid providers won't be used despite paid tier.`,
      );
    }

    // Case 3: tier_c but no preferredProvider (best-effort needs starting point)
    if (tier === 'tier_c' && !resolved.preferredProvider) {
      this.logger.warn(
        `[TIER_DRIFT] Profile ${profileId}: tier=tier_c (hostile) but no preferredProvider. ` +
        `Best-effort tier should have a preferred paid provider to start with.`,
      );
    }
  }

  /**
   * Apply explicit overrides to base policy
   * Only fields present in overrides are applied
   */
  private applyOverrides(base: TierPolicy, overrides: TierPolicyOverrides): void {
    if (overrides.disabledProviders !== undefined) {
      base.disabledProviders = [...overrides.disabledProviders];
      this.logger.debug(
        `Override disabledProviders: [${base.disabledProviders.join(',')}]`,
      );
    }

    if (overrides.stopAfterPreferredFailure !== undefined) {
      base.stopAfterPreferredFailure = overrides.stopAfterPreferredFailure;
      this.logger.debug(
        `Override stopAfterPreferredFailure: ${base.stopAfterPreferredFailure}`,
      );
    }

    if (overrides.preferredProvider !== undefined) {
      base.preferredProvider = overrides.preferredProvider;
      this.logger.debug(`Override preferredProvider: ${base.preferredProvider}`);
    }

    if (overrides.geoCountry !== undefined) {
      base.geoCountry = overrides.geoCountry;
      this.logger.debug(`Override geoCountry: ${base.geoCountry}`);
    }
    // NOTE: Per-provider timeouts removed - orchestrator uses FetchRequest.timeoutMs
  }

  // NOTE: getProviderTimeout removed - orchestrator uses FetchRequest.timeoutMs
  // Can be re-added when FetchOrchestrator supports per-provider timeouts

  /**
   * Check if a provider is enabled for this policy
   *
   * @param policy - Resolved TierPolicy
   * @param provider - Provider to check
   * @returns true if provider is allowed
   */
  isProviderEnabled(policy: TierPolicy, provider: string): boolean {
    return !policy.disabledProviders.includes(provider as any);
  }

  /**
   * Get the default tier for a domain (static method for use without DI)
   */
  static getDefaultTier(): DomainTier {
    return 'tier_a';
  }
}
