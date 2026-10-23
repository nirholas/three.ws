// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Pure parser for x.com's GraphQL `User` object.
 *
 * Kept apart from profile.js so it can be imported anywhere, including a
 * Cloudflare Worker: this file reaches for nothing but `errors.js`, while the
 * scraper it came from pulls in the HTTP client, the query-ID cache and the
 * Node filesystem behind it.
 *
 * @module scrapers/twitter/http/parse/user
 * @author nich (@nichxbt)
 */

import { NotFoundError } from './errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Expand t.co URLs using the entity data Twitter provides.
 *
 * @param {string} text, The raw text containing t.co links
 * @param {object[]} urlEntities, `legacy.entities.url.urls` or
 *   `legacy.entities.description.urls` arrays
 * @returns {string} Text with t.co links replaced by expanded URLs
 */
function expandTcoUrls(text, urlEntities = []) {
  if (!text || !urlEntities.length) return text || '';
  let expanded = text;
  for (const entity of urlEntities) {
    if (entity.url && entity.expanded_url) {
      expanded = expanded.replace(entity.url, entity.expanded_url);
    }
  }
  return expanded;
}

/**
 * Upgrade the avatar thumbnail URL to a higher-resolution version.
 *
 * Twitter serves `_normal` (48 × 48) by default, swap to `_400x400`.
 *
 * @param {string|null} url
 * @returns {string|null}
 */
function upgradeAvatarUrl(url) {
  if (!url) return null;
  return url.replace(/_normal(\.\w+)$/, '_400x400$1');
}

/**
 * Parse Twitter's `created_at` string ("Mon Jan 01 00:00:00 +0000 2007")
 * into an ISO-8601 date string.
 *
 * @param {string|null} raw
 * @returns {string|null}
 */
function toISODate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : d.toISOString();
}

/**
 * Safely extract the expanded website URL.
 *
 * @param {object} entities - `entities` from `profile_bio` or `legacy`.
 * @param {string|null} rawUrl - The unexpanded t.co URL.
 * @returns {string|null}
 */
function extractWebsite(entities, rawUrl) {
  const urlEntities = entities?.url?.urls;
  if (!urlEntities || !urlEntities.length) return rawUrl || null;
  // Prefer the expanded URL (resolves the t.co redirect)
  return urlEntities[0].expanded_url || urlEntities[0].url || rawUrl || null;
}

/**
 * Extract bio entity metadata (URLs, hashtags, mentions).
 *
 * @param {object} entities - `entities` from `profile_bio` or `legacy`.
 * @returns {{ urls: object[], hashtags: object[], mentions: object[] }}
 */
function extractBioEntities(entities) {
  const desc = entities?.description || {};
  return {
    urls: (desc.urls || []).map((u) => ({
      display: u.display_url,
      expanded: u.expanded_url,
      url: u.url,
      start: u.indices?.[0] ?? null,
      end: u.indices?.[1] ?? null,
    })),
    hashtags: (desc.hashtags || []).map((h) => ({
      text: h.text,
      start: h.indices?.[0] ?? null,
      end: h.indices?.[1] ?? null,
    })),
    mentions: (desc.user_mentions || []).map((m) => ({
      username: m.screen_name,
      start: m.indices?.[0] ?? null,
      end: m.indices?.[1] ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Core: parseUserData
// ---------------------------------------------------------------------------

/**
 * Transform Twitter's raw GraphQL user object into the clean XActions
 * profile format.
 *
 * This is a **pure function**, it performs no I/O and has no side effects.
 *
 * @param {object} rawUser, The `data.user.result` (or equivalent) object
 *   from a Twitter GraphQL response.
 * @returns {object} Normalised XActions profile object.
 * @throws {NotFoundError} If the user is unavailable (suspended / deactivated).
 */
export function parseUserData(rawUser) {
  if (!rawUser) {
    throw new NotFoundError('User data is empty');
  }

  // Handle UserUnavailable (suspended, deactivated, etc.)
  if (rawUser.__typename === 'UserUnavailable') {
    const reason = rawUser.reason || rawUser.message || 'Account unavailable';
    throw new NotFoundError(`User unavailable: ${reason}`);
  }

  // x.com is migrating User fields out of `legacy` into typed sub-objects
  // (core, avatar, banner, location, privacy, website, profile_bio,
  // relationship_counts, tweet_counts, action_counts, verification,
  // pinned_items). Guest responses no longer carry `legacy` at all, so read
  // the typed shape first and fall back to `legacy` for authenticated
  // responses and older fixtures that still return it.
  const legacy = rawUser.legacy || {};
  const core = rawUser.core || {};
  const bio = rawUser.profile_bio || {};
  const entities = bio.entities || legacy.entities || {};
  const counts = rawUser.relationship_counts || {};
  const tweetCounts = rawUser.tweet_counts || {};
  const actionCounts = rawUser.action_counts || {};
  const birthdate = rawUser.legacy_extended_profile?.birthdate || legacy.birthdate || null;
  const description = bio.description ?? legacy.description ?? '';
  const descriptionUrls = entities.description?.urls || [];

  return {
    id: rawUser.rest_id || null,
    name: core.name ?? legacy.name ?? '',
    username: core.screen_name ?? legacy.screen_name ?? '',
    bio: expandTcoUrls(description, descriptionUrls),
    location: rawUser.location?.location ?? legacy.location ?? '',
    website: extractWebsite(entities, rawUser.website?.url ?? legacy.url ?? null),
    joined: toISODate(core.created_at ?? legacy.created_at ?? null),
    birthday: birthdate
      ? `${birthdate.year || ''}${birthdate.month ? '-' + String(birthdate.month).padStart(2, '0') : ''}${birthdate.day ? '-' + String(birthdate.day).padStart(2, '0') : ''}`.trim() || null
      : null,
    following: counts.following ?? legacy.friends_count ?? 0,
    followers: counts.followers ?? legacy.followers_count ?? 0,
    tweets: tweetCounts.tweets ?? legacy.statuses_count ?? 0,
    likes: actionCounts.favorites_count ?? legacy.favourites_count ?? 0,
    media: tweetCounts.media_tweets ?? legacy.media_count ?? 0,
    avatar: upgradeAvatarUrl(rawUser.avatar?.image_url ?? legacy.profile_image_url_https ?? null),
    header: rawUser.banner?.image_url ?? legacy.profile_banner_url ?? null,
    verified: Boolean(
      rawUser.is_blue_verified || rawUser.verification?.verified || legacy.verified
    ),
    protected: Boolean(rawUser.privacy?.protected ?? legacy.protected),
    pinnedTweetId:
      (rawUser.pinned_items?.tweet_ids_str || legacy.pinned_tweet_ids_str || [])[0] || null,
    bioEntities: extractBioEntities(entities),
    platform: 'twitter',
  };
}
