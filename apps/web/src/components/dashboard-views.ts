import { maskSecret } from '@fb-auto/core';

export interface NavItem {
  id: string;
  label: string;
  href: string;
  badge?: number;
}

export const DASHBOARD_NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Overview', href: '/' },
  { id: 'pages', label: 'Pages & Wizard', href: '/pages' },
  { id: 'profiles', label: 'Prompt Studio & Profiles', href: '/prompts' },
  { id: 'review', label: 'Review Inbox', href: '/review' },
  { id: 'calendar', label: 'Queue & Calendar', href: '/calendar' },
  { id: 'providers', label: 'Providers & Chains', href: '/providers' },
  { id: 'history', label: 'History & Logs', href: '/history' },
  { id: 'settings', label: 'Settings', href: '/settings' },
];

export interface PageViewModel {
  id: string;
  name: string;
  fbPageId: string;
  tokenStatus: 'valid' | 'expired' | 'revoked' | 'rate_limited';
  publishingMode: 'auto' | 'review' | 'hybrid';
  hybridMinScore: number;
  dailyCap: number;
  active: boolean;
  linkedProfileId: string;
  linkedProfileName?: string;
  scheduleSummary: string;
}

export function formatPageViewModel(page: any, profileName = 'Default Profile'): PageViewModel {
  const schedule = page.schedule || {};
  const times = (schedule.postingTimes || ['10:00', '15:00', '20:00']).join(', ');
  const scheduleSummary = `${schedule.postsPerDay || 3} posts/day at ${times} (${schedule.timezone || 'UTC'})`;

  return {
    id: page.id,
    name: page.name,
    fbPageId: page.fb_page_id,
    tokenStatus: page.token_status || 'valid',
    publishingMode: page.publishing_mode || 'review',
    hybridMinScore: Number(page.hybrid_min_score || 80),
    dailyCap: page.daily_cap || 5,
    active: Boolean(page.active),
    linkedProfileId: page.profile_id,
    linkedProfileName: profileName,
    scheduleSummary,
  };
}

export interface ReviewCardViewModel {
  postId: string;
  pageName: string;
  title: string;
  headline?: string;
  caption: string;
  wordCount: number;
  hashtags: string[];
  scheduledFor: string;
  qaScore: number;
  sensitiveFlags: string[];
  imagePath?: string;
  hasVisualDuplicateWarning: boolean;
}

export function formatReviewCard(post: any, pageName = 'Facebook Page'): ReviewCardViewModel {
  const caption = post.caption || '';
  const words = caption.trim().split(/\s+/).filter(Boolean).length;
  const sensitiveFlags = Array.isArray(post.sensitive_flags) ? post.sensitive_flags : [];

  return {
    postId: post.id,
    pageName,
    title: post.title || post.topic_title || 'Untitled Post',
    headline: post.headline,
    caption,
    wordCount: post.caption_word_count || words,
    hashtags: Array.isArray(post.hashtags) ? post.hashtags : [],
    scheduledFor: post.scheduled_for,
    qaScore: Number(post.qa_score || 0),
    sensitiveFlags,
    imagePath: post.composed_image_path || post.raw_image_path,
    hasVisualDuplicateWarning: Boolean(post.image_phash && post.review_note?.includes('duplicate')),
  };
}

export interface ProviderItemViewModel {
  id: string;
  name: string;
  adapterKind: string;
  enabled: boolean;
  keyCount: number;
  maskedKeys: string[];
  quotaPercentUsed: number;
}

export function formatProviderViewModel(provider: any, keys: any[] = []): ProviderItemViewModel {
  const providerKeys = keys.filter((k) => k.provider_id === provider.id && k.is_active);
  const maskedKeys = providerKeys.map((k) => maskSecret(k.key_value || ''));

  return {
    id: provider.id,
    name: provider.name,
    adapterKind: provider.adapter_kind,
    enabled: Boolean(provider.enabled),
    keyCount: providerKeys.length,
    maskedKeys,
    quotaPercentUsed: Math.min(Math.round(((provider.used_today || 0) / (provider.daily_limit || 1000)) * 100), 100),
  };
}

