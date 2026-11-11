import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAutonomousCycle } from '../packages/core/src/scheduler/autonomous-cycle.js';
import { FacebookPublisher } from '../packages/core/src/facebook/publisher.js';
import * as dbModule from '../packages/core/src/db/client.js';

describe('Autonomous Worker Cycle & 30-Minute Pre-Generation Window', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('safely handles missing Supabase client', async () => {
    vi.spyOn(dbModule, 'getSupabaseClient').mockReturnValue(null);

    const result = await runAutonomousCycle();
    expect(result.executed).toBe(false);
    expect(result.message).toContain('unavailable');
  });

  it('runs reconciliation and scans active pages', async () => {
    const mockPosts: any[] = [];
    const mockPages = [
      {
        id: 'page-1',
        name: 'Beyond the Known',
        fb_page_id: '1347402001799226',
        fb_page_token: 'valid_test_token',
        token_status: 'valid',
        active: true,
        publishing_mode: 'auto',
        schedule: {
          is_live: true,
          postsPerDay: 5,
          postingTimes: ['08:00', '10:00', '12:00', '15:00', '17:00'],
          timezone: 'America/New_York',
        },
      },
    ];

    const mockSupabase: any = {
      from: vi.fn((table: string) => {
        if (table === 'posts') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                not: vi.fn(() => ({
                  lte: vi.fn(() => ({
                    limit: vi.fn(async () => ({ data: [], error: null })),
                  })),
                })),
                lte: vi.fn(() => ({
                  limit: vi.fn(async () => ({ data: [], error: null })),
                })),
                gte: vi.fn(() => ({
                  lte: vi.fn(() => ({
                    not: vi.fn(() => ({
                      limit: vi.fn(async () => ({ data: [], error: null })),
                    })),
                  })),
                })),
              })),
            })),
            insert: vi.fn((payload) => ({
              select: vi.fn(() => ({
                single: vi.fn(async () => {
                  mockPosts.push(payload);
                  return { data: { id: 'mock-post-1', ...payload }, error: null };
                }),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(async () => ({ error: null })),
            })),
          };
        }
        if (table === 'pages') {
          return {
            select: vi.fn(() => Promise.resolve({ data: mockPages, error: null })),
          };
        }
        if (table === 'content_profiles') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: {
                    id: 'prof-1',
                    name: 'Science & Space',
                    type: 'factual',
                  },
                })),
              })),
              ilike: vi.fn(() => ({
                limit: vi.fn(async () => ({
                  data: [
                    {
                      id: 'prof-1',
                      name: 'Science & Space',
                      type: 'factual',
                    },
                  ],
                })),
              })),
            })),
          };
        }
        return {
          insert: vi.fn(async () => ({ error: null })),
          select: vi.fn(() => Promise.resolve({ data: [], error: null })),
        };
      }),
    };

    vi.spyOn(dbModule, 'getSupabaseClient').mockReturnValue(mockSupabase);
    vi.spyOn(FacebookPublisher.prototype, 'publishFeedPost').mockResolvedValue({
      postId: 'fb_post_mock_123',
      photoId: 'fb_photo_mock_456',
      scheduledPublishTime: 1794402000,
      isScheduled: true,
      permalinkUrl: 'https://facebook.com/123/posts/123',
    });

    // Run cycle with slot 30 minutes in the future
    const now = new Date('2026-11-11T12:30:00Z'); // 30 minutes before 13:00 UTC (8:00 AM EST)
    const result = await runAutonomousCycle({
      now,
      forceSlotGeneration: true,
    });

    expect(result.executed).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.generatedPosts.length).toBeGreaterThanOrEqual(1);
    expect(result.generatedPosts[0].pageName).toBe('Beyond the Known');
  });
});

