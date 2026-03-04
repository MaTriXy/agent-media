// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * AgentMediaAPI - HTTP client wrapping fetch to Supabase Edge Functions.
 *
 * All CLI-to-server communication goes through this class. It handles
 * authentication headers, base URL resolution, JSON parsing, and
 * structured error responses.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CLIError } from './errors.js';

/** Default Supabase project URL. Override via AGENT_MEDIA_API_URL. */
const DEFAULT_API_URL = 'https://ppwvarkmpffljlqxkjux.supabase.co';

// ── Local disk cache for models/pricing (avoids cold API calls) ─────────

const CACHE_DIR = join(
  process.env['AGENT_MEDIA_CONFIG_DIR'] ?? join(process.env['HOME'] ?? '.', '.agent-media'),
  'cache',
);
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function readCache<T>(key: string): T | null {
  try {
    const file = join(CACHE_DIR, `${key}.json`);
    if (!existsSync(file)) return null;
    const raw = readFileSync(file, 'utf-8');
    const { ts, data } = JSON.parse(raw) as { ts: number; data: T };
    if (Date.now() - ts > CACHE_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, data: T): void {
  try {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(join(CACHE_DIR, `${key}.json`), JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // Non-critical — cache write failures are silent
  }
}

// Public anon key — safe to embed. All access is gated by RLS policies.
// This is equivalent to NEXT_PUBLIC_SUPABASE_ANON_KEY on the frontend.
// Override for local dev via AGENT_MEDIA_ANON_KEY env var.
const DEFAULT_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwd3ZhcmttcGZmbGpscXhranV4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzMTI4MDksImV4cCI6MjA4Njg4ODgwOX0.H9tcntgnAJVziWNKUomlgdoCi7FGe-5RUxqzaVCZR44';

/** Response shape for the device-token initiation endpoint (snake_case from server). */
export interface DeviceAuthResponse {
  device_code: string;
  user_code: string;
  confirmation_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
}

/** Response shape when polling the device-token endpoint (snake_case from server). */
export interface DevicePollResponse {
  status: 'pending' | 'approved' | 'expired' | 'denied';
  api_key?: string;
  key_prefix?: string;
  user_id?: string;
}

/** Response shape for the whoami / credits-check endpoint. */
export interface WhoAmIResponse {
  user_id: string;
  plan: {
    tier: string;
    name: string;
    status: string;
    trial_active: boolean;
    trial_ends_at: string | null;
    current_period_end: string | null;
  };
  credits: {
    monthly_remaining: number;
    monthly_allowance?: number;
    purchased: number;
    total: number;
  };
  limits: {
    max_concurrent_jobs: number;
    max_video_duration: number;
    models_available: string[];
  };
}

/** Response shape for the checkout endpoint (snake_case from server). */
export interface CheckoutResponse {
  checkout_url?: string;
  session_id?: string;
  upgraded?: boolean;
  plan_tier?: string;
}

/** Response shape for the Stripe portal endpoint. */
export interface PortalResponse {
  portal_url: string;
}

/** Parameters for submitting a subtitle job. */
export interface SubtitleVideoParams {
  storagePath?: string;
  jobId?: string;
  style?: string;
}

/** Response shape for the subtitle-video endpoint. */
export interface SubtitleVideoResponse {
  job_id: string;
  status: string;
  credits_deducted: number;
}

/** Parameters for submitting a UGC video job. */
export interface UGCGenerateParams {
  script: string;
  voice?: string;
  model?: string;
  style?: string;
  tone?: string;
  persona_slug?: string;
  actor_slug?: string;
  face_photo_url?: string;
  target_duration?: number;
  aspect_ratio?: '9:16' | '16:9' | '1:1';
  music?: string;
  cta?: string;
  generate_script?: boolean;
  script_prompt?: string;
  product_url?: string;
  tts_provider?: 'openai' | 'elevenlabs' | 'hume';
  allow_broll?: boolean;
  broll_images?: string[];
  dub_language?: string;
  scenes?: Array<{ type: string; text: string; visual_prompt?: string; image?: string }>;
  product_image_url?: string;
  template?: string;
  broll_model?: string;
  voice_speed?: number;
}

/** Response shape for the ugc-video endpoint. */
export interface UGCGenerateResponse {
  job_id: string;
  status: string;
  estimated_duration: number;
  credits_deducted: number;
  generated_script?: string;
  selected_voice?: string;
  voice_auto_detected?: boolean;
}

/** Parameters for creating a persona via multipart upload. */
export interface CreatePersonaParams {
  name: string;
  voiceSample: Buffer;
  voiceFileName: string;
  voiceMimeType: string;
  facePhoto: Buffer;
  faceFileName: string;
  faceMimeType: string;
}

/** Response shape from persona-create. */
export interface CreatePersonaResponse {
  persona_id: string;
  name: string;
  slug: string;
  voice_clone_status: string;
  voice_id: string | null;
  face_photo_url: string;
}

/** Response shape from persona-list. */
export interface ListPersonasResponse {
  personas: PersonaRecord[];
}

/** A persona record. */
export interface PersonaRecord {
  id: string;
  name: string;
  slug: string;
  voice_provider: string;
  voice_id: string | null;
  voice_clone_status: string;
  face_photo_url: string;
  subtitle_style: string | null;
  pacing: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

/** Parameters for deleting a persona. */
export interface DeletePersonaParams {
  persona_id?: string;
  slug?: string;
}

/** Response shape from persona-delete. */
export interface DeletePersonaResponse {
  deleted: boolean;
  persona_id: string;
  voice_deleted: boolean;
}

/** Parameters for submitting a generation job. */
export interface SubmitGenerationParams {
  modelSlug: string;
  prompt: string;
  duration?: number;
  resolution?: string;
  aspectRatio?: string;
  seed?: number;
  inputMediaUrl?: string;
  idempotencyKey?: string;
  dryRun?: boolean;
}

/** Response shape for the generate endpoint. */
export interface GenerateResponse {
  job_id: string;
  status: string;
  credits_deducted: number;
  estimated_duration: number | null;
}

/** Response shape for a dry-run cost estimate. */
export interface CostEstimateResponse {
  credits: number;
  costUsd: number;
  availableCredits: number;
  canAfford: boolean;
  modelDisplayName: string;
  breakdown: {
    planCredits: number;
    purchasedCredits: number;
  };
}

/** Response shape for the upload-url endpoint (snake_case from server). */
export interface UploadUrlResponse {
  upload_url: string;
  storage_path: string;
  expires_in: number;
}

/** Response shape for the presigned-url endpoint. */
export interface PresignedUrlResponse {
  url: string;
  expiresAt: string;
  type: 'media' | 'thumbnail';
  external?: boolean;
}

/** A model row from the models table. */
export interface ModelInfo {
  slug: string;
  display_name: string;
  description: string;
  media_type: 'video' | 'image';
  supports_text_to_video: boolean;
  supports_image_to_video: boolean;
  supports_text_to_image: boolean;
  max_duration_seconds: number | null;
  max_resolution: string | null;
  is_active: boolean;
}

/** A single pricing entry for a model. */
export interface PricingEntry {
  modelSlug: string;
  operation: string;
  durationSeconds: number | null;
  resolution: string | null;
  creditCost: number;
  providerCostUsd: number;
}

/** Response shape for the pricing endpoint. */
export interface PricingResponse {
  pricing: PricingEntry[];
}

/** Options for listing generation jobs. */
export interface ListJobsOptions {
  status?: string;
  model?: string;
  limit?: number;
  offset?: number;
  sort?: 'newest' | 'oldest';
}

/** Response shape for listing generation jobs with total count. */
export interface ListJobsResponse {
  jobs: GenerationJob[];
  total: number;
}

/** Shape of a generation_jobs row from Supabase REST API. */
export interface GenerationJob {
  id: string;
  user_id: string;
  model_slug: string;
  model_display_name: string | null;
  operation: string;
  status: 'pending' | 'submitted' | 'processing' | 'completed' | 'failed' | 'canceled';
  prompt: string;
  negative_prompt: string | null;
  input_media_url: string | null;
  duration_seconds: number | null;
  resolution: string | null;
  aspect_ratio: string | null;
  seed: number | null;
  credit_cost: number;
  credits_charged: number | null;
  credits_refunded: boolean;
  provider_cost_usd: number | null;
  provider_job_id: string | null;
  provider_slug: string | null;
  webhook_checkpoint: string;
  progress_detail: { stage?: string; progress_pct?: number | null; message?: string | null } | null;
  output_media_url: string | null;
  output_thumbnail_url: string | null;
  error_message: string | null;
  error_code: string | null;
  started_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

/** Response shape for deleting a job. */
export interface DeleteJobResponse {
  success: boolean;
  jobId: string;
  deletedAt: string;
}

/** Response shape for restoring a soft-deleted job. */
export interface RestoreJobResponse {
  success: boolean;
  jobId: string;
  restored: boolean;
}

/** A single credit transaction row from the credit_transactions table. */
export interface CreditTransaction {
  id: string;
  type: 'debit' | 'credit' | 'refund' | 'reset';
  amount: number;
  plan_credits_after: number;
  purchased_credits_after: number;
  description: string;
  created_at: string;
}

/** Options for fetching credit transaction history. */
export interface CreditHistoryOptions {
  limit?: number;
  type?: string;
}

/** Response shape for auto-top-up configuration. */
export interface AutoTopUpConfigResponse {
  enabled: boolean;
  threshold_credits: number;
  pack_slug: string;
  max_monthly_topups: number;
  updated_at: string | null;
}

/** Parameters for updating auto-top-up configuration. */
export interface UpdateAutoTopUpConfigParams {
  enabled?: boolean;
  threshold_credits?: number;
  pack_slug?: string;
  max_monthly_topups?: number;
}

/** A record from the api_keys table (list response shape). */
export interface ApiKeyRecord {
  id: string;
  key_prefix: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

/** Response shape for creating a new API key. */
export interface CreateApiKeyResponse {
  key: string;
  id: string;
  key_prefix: string;
  name: string;
  created_at: string;
}

/** Response shape for revoking a managed API key. */
export interface RevokeApiKeyResponse {
  revoked: boolean;
  id: string;
}

/** Summary section of the usage-stats response. */
export interface UsageStatsSummary {
  total_jobs: number;
  completed_jobs: number;
  failed_jobs: number;
  credits_used: number;
}

/** Per-model breakdown row from usage-stats. */
export interface UsageModelBreakdown {
  model_slug: string;
  job_count: number;
  credits_used: number;
  avg_duration_seconds: number | null;
}

/** Daily usage row from usage-stats. */
export interface UsageDailyEntry {
  date: string;
  job_count: number;
  credits_used: number;
}

/** Per-operation breakdown row from usage-stats. */
export interface UsageOperationBreakdown {
  operation: string;
  job_count: number;
}

/** Full response shape from the usage-stats edge function. */
export interface UsageStats {
  period: string;
  period_start: string;
  period_end: string;
  summary: UsageStatsSummary;
  by_model: UsageModelBreakdown[];
  daily: UsageDailyEntry[];
  by_operation: UsageOperationBreakdown[];
}

/** Response shape for job debug info from the health-status edge function. */
export interface JobDebugInfo {
  job: GenerationJob;
  transactions: CreditTransaction[];
  webhookHistory: Array<{
    id: string;
    event: string;
    status: string;
    payload: Record<string, unknown>;
    created_at: string;
  }>;
  deadLetterEntries: Array<{
    id: string;
    error: string;
    attempts: number;
    created_at: string;
    last_attempt_at: string;
  }>;
}

/** Response shape for credit debug info from the health-status edge function. */
export interface CreditDebugInfo {
  balance: {
    plan_credits: number;
    purchased_credits: number;
    total: number;
  };
  transactions: CreditTransaction[];
  reconciliation: {
    expectedBalance: number;
    actualBalance: number;
    isBalanced: boolean;
    discrepancy: number;
    lastCheckedAt: string | null;
  };
}

/** Structured error returned from Edge Functions. */
interface ApiErrorBody {
  error: string;
  error_description?: string;
  code?: string;
  suggestion?: string;
}

export class AgentMediaAPI {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly anonKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? '';
    this.baseUrl =
      process.env['AGENT_MEDIA_API_URL']?.replace(/\/+$/, '') ?? DEFAULT_API_URL;
    this.anonKey =
      process.env['AGENT_MEDIA_ANON_KEY'] ?? DEFAULT_ANON_KEY;
  }

  /**
   * Initiate the device-code OAuth flow.
   * No auth required -- the device is not yet authenticated.
   */
  static async initiateDeviceFlow(baseUrl?: string): Promise<DeviceAuthResponse> {
    const url =
      (baseUrl ?? process.env['AGENT_MEDIA_API_URL'] ?? DEFAULT_API_URL).replace(
        /\/+$/,
        '',
      );
    const anonKey = process.env['AGENT_MEDIA_ANON_KEY'] ?? DEFAULT_ANON_KEY;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (anonKey) {
      headers['apikey'] = anonKey;
      headers['Authorization'] = `Bearer ${anonKey}`;
    }

    const res = await fetch(`${url}/functions/v1/device-token`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      await throwApiError(res, 'Failed to initiate device login');
    }

    return (await res.json()) as DeviceAuthResponse;
  }

  /**
   * Poll the device-token endpoint during the login flow.
   * No auth required. Returns status-based responses without throwing on
   * expected non-200 codes (428 pending, 410 expired, 403 denied).
   */
  static async pollDeviceToken(
    deviceCode: string,
    baseUrl?: string,
  ): Promise<DevicePollResponse> {
    const url =
      (baseUrl ?? process.env['AGENT_MEDIA_API_URL'] ?? DEFAULT_API_URL).replace(
        /\/+$/,
        '',
      );
    const anonKey = process.env['AGENT_MEDIA_ANON_KEY'] ?? DEFAULT_ANON_KEY;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (anonKey) {
      headers['apikey'] = anonKey;
      headers['Authorization'] = `Bearer ${anonKey}`;
    }

    const res = await fetch(`${url}/functions/v1/device-token/poll`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ device_code: deviceCode }),
    });

    // 428 = authorization_pending (still waiting for user)
    if (res.status === 428) {
      return { status: 'pending' };
    }

    // 410 = expired token
    if (res.status === 410) {
      return { status: 'expired' };
    }

    // 403 = access denied
    if (res.status === 403) {
      return { status: 'denied' };
    }

    if (!res.ok) {
      await throwApiError(res, 'Failed to poll device token');
    }

    const data = (await res.json()) as DevicePollResponse;
    return data;
  }

  /**
   * Get the authenticated user's profile, subscription, and credit info.
   */
  async whoami(): Promise<WhoAmIResponse> {
    const res = await this.request('GET', '/functions/v1/credits-check');
    return (await res.json()) as WhoAmIResponse;
  }

  /**
   * Get the authenticated user's credit balance and subscription info.
   *
   * Identical endpoint to whoami but semantically focused on credits.
   * Returns the same shape, allowing credits/plan commands to share the call.
   */
  async getCredits(): Promise<WhoAmIResponse> {
    const res = await this.request('GET', '/functions/v1/credits-check');
    return (await res.json()) as WhoAmIResponse;
  }

  /**
   * Create a Stripe Checkout session for a subscription plan.
   *
   * Returns a checkout URL that can be opened in the user's browser.
   */
  async createPlanCheckout(planTier: string): Promise<CheckoutResponse> {
    const res = await this.request('POST', '/functions/v1/checkout', {
      plan_tier: planTier,
    });
    return (await res.json()) as CheckoutResponse;
  }

  /**
   * Create a Stripe Checkout session for a PAYG credit pack.
   *
   * Returns a checkout URL that can be opened in the user's browser.
   */
  async createPaygCheckout(packId: string): Promise<CheckoutResponse> {
    const res = await this.request('POST', '/functions/v1/checkout', {
      payg_pack_id: packId,
    });
    return (await res.json()) as CheckoutResponse;
  }

  /**
   * Create a Stripe Customer Portal session for managing subscription.
   *
   * Returns a portal URL that can be opened in the user's browser.
   */
  async createPortalSession(returnUrl?: string): Promise<PortalResponse> {
    const res = await this.request('POST', '/functions/v1/stripe-portal', {
      returnUrl: returnUrl ?? 'https://agent-media.ai/billing',
    });
    return (await res.json()) as PortalResponse;
  }

  /**
   * Revoke the current API key on the server side.
   */
  async revokeApiKey(): Promise<void> {
    await this.request('POST', '/functions/v1/device-token', {
      action: 'revoke',
    });
  }

  /**
   * Submit a generation job or perform a dry-run cost estimate.
   *
   * When `params.dryRun` is true the server returns a cost estimate
   * without creating a job or deducting credits.
   */
  async submitGeneration(
    params: SubmitGenerationParams,
  ): Promise<GenerateResponse | CostEstimateResponse> {
    const body: Record<string, unknown> = {
      model: params.modelSlug,
      prompt: params.prompt,
      dry_run: params.dryRun ?? false,
    };

    if (params.duration !== undefined) body['duration'] = params.duration;
    if (params.resolution !== undefined) body['resolution'] = params.resolution;
    if (params.aspectRatio !== undefined) body['aspect_ratio'] = params.aspectRatio;
    if (params.seed !== undefined) body['seed'] = params.seed;
    if (params.inputMediaUrl !== undefined) body['input_media_url'] = params.inputMediaUrl;
    if (params.idempotencyKey !== undefined) body['idempotency_key'] = params.idempotencyKey;

    const res = await this.request('POST', '/functions/v1/generate', body);

    if (params.dryRun) {
      return (await res.json()) as CostEstimateResponse;
    }

    return (await res.json()) as GenerateResponse;
  }

  /**
   * Submit a subtitle processing job.
   *
   * Sends a video (by storage path or source job ID) to the subtitle-video
   * edge function for Hormozi-style subtitle processing.
   */
  async subtitleVideo(params: SubtitleVideoParams): Promise<SubtitleVideoResponse> {
    const body: Record<string, unknown> = {};
    if (params.storagePath) body['storage_path'] = params.storagePath;
    if (params.jobId) body['job_id'] = params.jobId;
    if (params.style) body['style'] = params.style;

    const res = await this.request('POST', '/functions/v1/subtitle-video', body);
    return (await res.json()) as SubtitleVideoResponse;
  }

  /**
   * Submit a UGC video production job.
   *
   * Sends a script to the ugc-video edge function for full production
   * pipeline: scene splitting, TTS, B-roll generation, and assembly.
   */
  async ugcGenerate(params: UGCGenerateParams): Promise<UGCGenerateResponse> {
    const body: Record<string, unknown> = { script: params.script };
    if (params.voice) body['voice'] = params.voice;
    if (params.model) body['model'] = params.model;
    if (params.style) body['style'] = params.style;
    if (params.persona_slug) body['persona_slug'] = params.persona_slug;
    if (params.actor_slug) body['actor_slug'] = params.actor_slug;
    if (params.face_photo_url) body['face_photo_url'] = params.face_photo_url;
    if (params.target_duration) body['target_duration'] = params.target_duration;
    if (params.aspect_ratio) body['aspect_ratio'] = params.aspect_ratio;
    if (params.music) body['music'] = params.music;
    if (params.cta) body['cta'] = params.cta;
    if (params.generate_script) body['generate_script'] = params.generate_script;
    if (params.script_prompt) body['script_prompt'] = params.script_prompt;
    if (params.product_url) body['product_url'] = params.product_url;
    if (params.tts_provider) body['tts_provider'] = params.tts_provider;
    if (params.allow_broll) body['allow_broll'] = true;
    if (params.broll_images?.length) body['broll_images'] = params.broll_images;
    if (params.dub_language) body['dub_language'] = params.dub_language;
    if (params.scenes?.length) body['scenes_input'] = params.scenes;
    if (params.product_image_url) body['product_image_url'] = params.product_image_url;
    if (params.template) body['template'] = params.template;
    if (params.broll_model) body['broll_model'] = params.broll_model;
    if (params.voice_speed != null) body['voice_speed'] = params.voice_speed;

    const res = await this.request('POST', '/functions/v1/ugc-video', body, 60_000);
    return (await res.json()) as UGCGenerateResponse;
  }

  /**
   * List all personas for the authenticated user.
   */
  async listPersonas(): Promise<ListPersonasResponse> {
    const res = await this.request('GET', '/functions/v1/persona-list');
    return (await res.json()) as ListPersonasResponse;
  }

  /**
   * Create a new persona by uploading voice sample + face photo.
   *
   * Uses multipart/form-data upload directly (not JSON).
   */
  async createPersona(params: CreatePersonaParams): Promise<CreatePersonaResponse> {
    const formData = new FormData();
    formData.append('name', params.name);
    formData.append(
      'voice_sample',
      new Blob([new Uint8Array(params.voiceSample)], { type: params.voiceMimeType }),
      params.voiceFileName,
    );
    formData.append(
      'face_photo',
      new Blob([new Uint8Array(params.facePhoto)], { type: params.faceMimeType }),
      params.faceFileName,
    );

    const url = `${this.baseUrl}/functions/v1/persona-create`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (this.anonKey) {
      headers['apikey'] = this.anonKey;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000); // 2 min for upload + voice clone

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: formData,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new CLIError('Persona creation timed out after 120s', {
          code: 'REQUEST_TIMEOUT',
          suggestion: 'Voice cloning may take time. Check your network and try again.',
        });
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      await throwApiError(res, 'Failed to create persona');
    }

    return (await res.json()) as CreatePersonaResponse;
  }

  /**
   * Delete a persona by ID or slug.
   */
  async deletePersona(params: DeletePersonaParams): Promise<DeletePersonaResponse> {
    const res = await this.request('POST', '/functions/v1/persona-delete', params);
    return (await res.json()) as DeletePersonaResponse;
  }

  // ── Actor Library (public, no auth required) ───────────────────────────

  /**
   * List actors with optional filters. Public endpoint, no auth needed.
   */
  async listActors(params?: URLSearchParams): Promise<{ actors: unknown[]; total: number }> {
    const qs = params?.toString() ? `?${params.toString()}` : '';
    const res = await this.requestPublic('GET', `/functions/v1/actors${qs}`);
    return (await res.json()) as { actors: unknown[]; total: number };
  }

  /**
   * Get a single actor by slug. Public endpoint, no auth needed.
   */
  async getActor(slug: string): Promise<{ actor: Record<string, unknown> }> {
    const res = await this.requestPublic('GET', `/functions/v1/actors?slug=${encodeURIComponent(slug)}`);
    return (await res.json()) as { actor: Record<string, unknown> };
  }

  /**
   * Get a presigned upload URL for an input media file.
   *
   * The returned `uploadUrl` can be used with {@link uploadFile} to
   * upload the file directly to storage.
   */
  async getUploadUrl(
    filename: string,
    contentType: string,
  ): Promise<UploadUrlResponse> {
    const res = await this.request('POST', '/functions/v1/upload-url', {
      filename,
      content_type: contentType,
    });
    return (await res.json()) as UploadUrlResponse;
  }

  /**
   * Upload a file to a presigned storage URL.
   *
   * This sends a PUT request directly to the storage endpoint
   * (not through the API base URL).
   */
  async uploadFile(uploadUrl: string, fileBuffer: ArrayBuffer, contentType: string): Promise<void> {
    const blob = new Blob([fileBuffer], { type: contentType });
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: blob,
    });

    if (!res.ok) {
      throw new CLIError(`File upload failed (HTTP ${res.status})`, {
        code: 'UPLOAD_FAILED',
        suggestion: 'Check the file path and try again.',
      });
    }
  }

  /**
   * Fetch the list of active models from the models table via PostgREST.
   *
   * Uses the anon key for auth since models are public data accessible
   * to all roles (anon RLS policy: is_active = true).
   */
  async getModels(): Promise<ModelInfo[]> {
    const cached = readCache<ModelInfo[]>('models');
    if (cached) return cached;

    const path = '/rest/v1/models?is_active=eq.true&select=slug,display_name,description,media_type,supports_text_to_video,supports_image_to_video,supports_text_to_image,max_duration_seconds,max_resolution,is_active&order=media_type.desc,slug.asc';
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        apikey: this.anonKey,
        Authorization: `Bearer ${this.anonKey}`,
      },
    });
    if (!res.ok) {
      await throwApiError(res, 'Failed to fetch models');
    }
    const data = (await res.json()) as ModelInfo[];
    writeCache('models', data);
    return data;
  }

  /**
   * Fetch pricing information for all models or a specific model.
   *
   * When `modelSlug` is provided, only pricing rows for that model are
   * returned. Otherwise the full pricing table is returned.
   */
  async getPricing(modelSlug?: string): Promise<PricingResponse> {
    const cacheKey = modelSlug ? `pricing-${modelSlug}` : 'pricing-all';
    const cached = readCache<PricingResponse>(cacheKey);
    if (cached) return cached;

    const path = modelSlug
      ? `/functions/v1/pricing?model=${encodeURIComponent(modelSlug)}`
      : '/functions/v1/pricing';

    const res = await this.request('GET', path);
    const data = (await res.json()) as PricingResponse;
    writeCache(cacheKey, data);
    return data;
  }

  /**
   * Fetch a single generation job by ID via the job-status edge function.
   *
   * Uses edge function auth (supports API keys) instead of PostgREST.
   */
  async getJob(jobId: string): Promise<GenerationJob> {
    const res = await this.request('POST', '/functions/v1/job-status', { jobId });
    const job = (await res.json()) as GenerationJob;

    if (!job || !job.id) {
      throw new CLIError(`Job not found: ${jobId}`, {
        code: 'JOB_NOT_FOUND',
        suggestion: 'Check the job ID and try again.',
      });
    }

    return job;
  }

  /**
   * Poll the provider for a job's real status (triggers server-side provider check).
   * Returns the provider-checked status including output_media_url if completed.
   */
  async pollProvider(jobId: string): Promise<{ status: string; output_media_url?: string; progress?: number }> {
    const res = await this.request('POST', '/functions/v1/poll-provider', { jobId }, 60_000);
    return (await res.json()) as { status: string; output_media_url?: string; progress?: number };
  }

  /**
   * Cancel an active job and refund credits.
   */
  async cancelJob(jobId: string): Promise<{ canceled: boolean; credits_refunded: number }> {
    const res = await this.request('POST', '/functions/v1/job-status', {
      cancel: true,
      jobId,
    });
    return (await res.json()) as { canceled: boolean; credits_refunded: number };
  }

  /**
   * List generation jobs via the job-status edge function.
   *
   * Uses edge function auth (supports API keys) instead of PostgREST.
   */
  async listJobs(options?: ListJobsOptions): Promise<ListJobsResponse> {
    const res = await this.request('POST', '/functions/v1/job-status', {
      list: true,
      limit: options?.limit ?? 20,
      offset: options?.offset ?? 0,
      status: options?.status,
      model: options?.model,
      sort: options?.sort,
    });

    const data = (await res.json()) as { jobs: GenerationJob[]; total: number };
    return { jobs: data.jobs ?? [], total: data.total ?? 0 };
  }

  /**
   * Download media from a URL and write it to a local file path.
   *
   * Streams the response body to disk and reports progress via an
   * optional callback. Returns the total number of bytes written.
   */
  async downloadMedia(
    url: string,
    outputPath: string,
    onProgress?: (receivedBytes: number, totalBytes: number | null) => void,
  ): Promise<number> {
    const { createWriteStream } = await import('node:fs');
    const { pipeline } = await import('node:stream/promises');
    const { Readable } = await import('node:stream');

    const res = await fetch(url);

    if (!res.ok) {
      throw new CLIError(`Download failed (HTTP ${res.status})`, {
        code: 'DOWNLOAD_FAILED',
        suggestion: 'The media file may have expired. Try re-checking the job status.',
      });
    }

    const contentLength = res.headers.get('content-length');
    const totalBytes = contentLength ? parseInt(contentLength, 10) : null;
    let receivedBytes = 0;

    if (!res.body) {
      throw new CLIError('Download failed: empty response body', {
        code: 'DOWNLOAD_FAILED',
        suggestion: 'Try again later.',
      });
    }

    const fileStream = createWriteStream(outputPath);

    // Create a transform that tracks progress
    const reader = res.body.getReader();
    const nodeStream = new Readable({
      async read() {
        const { done, value } = await reader.read();
        if (done) {
          this.push(null);
          return;
        }
        receivedBytes += value.byteLength;
        if (onProgress) onProgress(receivedBytes, totalBytes);
        this.push(Buffer.from(value));
      },
    });

    await pipeline(nodeStream, fileStream);
    return receivedBytes;
  }

  /**
   * Retry a failed or canceled generation job.
   *
   * Fetches the original job, verifies it is in a retryable state,
   * then re-submits a new generation with the same parameters.
   * Optional overrides allow changing the prompt or seed.
   * A new idempotency key is generated to ensure a fresh submission.
   */
  async retryJob(
    jobId: string,
    overrides?: { prompt?: string; seed?: number },
  ): Promise<GenerateResponse> {
    const originalJob = await this.getJob(jobId);

    if (originalJob.status !== 'failed' && originalJob.status !== 'canceled') {
      throw new CLIError(
        `Cannot retry job with status "${originalJob.status}". Only failed or canceled jobs can be retried.`,
        {
          code: 'INVALID_JOB_STATUS',
          suggestion: `Job ${jobId} is currently ${originalJob.status}. Use 'agent-media status ${jobId}' to check details.`,
        },
      );
    }

    const params: SubmitGenerationParams = {
      modelSlug: originalJob.model_slug,
      prompt: overrides?.prompt ?? originalJob.prompt,
      duration: originalJob.duration_seconds ?? undefined,
      resolution: originalJob.resolution ?? undefined,
      aspectRatio: originalJob.aspect_ratio ?? undefined,
      seed: overrides?.seed ?? originalJob.seed ?? undefined,
      idempotencyKey: crypto.randomUUID(),
    };

    return (await this.submitGeneration(params)) as GenerateResponse;
  }

  /**
   * Soft-delete a generation job.
   *
   * Calls the gallery-delete edge function. The job is marked as
   * soft-deleted and can be restored within the retention window.
   */
  async deleteJob(jobId: string): Promise<DeleteJobResponse> {
    const res = await this.request('POST', '/functions/v1/gallery-delete', {
      jobId,
    });
    return (await res.json()) as DeleteJobResponse;
  }

  /**
   * Restore a soft-deleted generation job.
   *
   * Calls the gallery-delete edge function with the restore flag.
   * Returns whether the job was successfully restored.
   */
  async restoreJob(jobId: string): Promise<RestoreJobResponse> {
    const res = await this.request('POST', '/functions/v1/gallery-delete', {
      jobId,
      restore: true,
    });
    return (await res.json()) as RestoreJobResponse;
  }

  /**
   * Get a presigned download URL for a job's output media or thumbnail.
   *
   * For Supabase Storage files, returns a freshly signed URL with a 1-hour TTL.
   * For external provider-hosted files, returns the URL directly.
   */
  async getPresignedUrl(
    jobId: string,
    type: 'media' | 'thumbnail',
  ): Promise<PresignedUrlResponse> {
    const res = await this.request('POST', '/functions/v1/presigned-url', {
      jobId,
      type,
    });
    return (await res.json()) as PresignedUrlResponse;
  }

  /**
   * Fetch the authenticated user's credit transaction history.
   *
   * Uses the PostgREST query syntax on the credit_transactions table.
   * Supports filtering by transaction type and limiting the number of rows.
   * Results are ordered by created_at descending (newest first).
   */
  async getCreditHistory(options?: CreditHistoryOptions): Promise<CreditTransaction[]> {
    const limit = options?.limit ?? 20;

    const params = new URLSearchParams();
    params.set('select', 'id,type,amount,plan_credits_after,purchased_credits_after,description,created_at');
    params.set('order', 'created_at.desc');
    params.set('limit', String(limit));

    if (options?.type) {
      params.set('type', `eq.${options.type}`);
    }

    const path = `/rest/v1/credit_transactions?${params.toString()}`;
    const res = await this.request('GET', path);
    return (await res.json()) as CreditTransaction[];
  }

  /**
   * List all active API keys for the authenticated user.
   *
   * Calls the apikey-manage edge function with action "list".
   * Returns key metadata only -- raw key values are never returned after creation.
   */
  async listApiKeys(): Promise<ApiKeyRecord[]> {
    const res = await this.request('POST', '/functions/v1/apikey-manage', {
      action: 'list',
    });
    const body = (await res.json()) as { keys: ApiKeyRecord[] };
    return body.keys;
  }

  /**
   * Create a new API key with the given display name.
   *
   * Calls the apikey-manage edge function with action "create".
   * The raw key is returned exactly once -- it cannot be retrieved later.
   */
  async createApiKey(name: string): Promise<CreateApiKeyResponse> {
    const res = await this.request('POST', '/functions/v1/apikey-manage', {
      action: 'create',
      name,
    });
    return (await res.json()) as CreateApiKeyResponse;
  }

  /**
   * Revoke a managed API key by its ID.
   *
   * Calls the apikey-manage edge function with action "revoke".
   * The key is soft-deleted and can no longer be used for authentication.
   */
  async revokeManagedApiKey(keyId: string): Promise<RevokeApiKeyResponse> {
    const res = await this.request('POST', '/functions/v1/apikey-manage', {
      action: 'revoke',
      keyId,
    });
    return (await res.json()) as RevokeApiKeyResponse;
  }

  /**
   * Get the authenticated user's auto-top-up configuration.
   *
   * Returns the current settings or server-side defaults if none exist.
   */
  async getAutoTopUpConfig(): Promise<AutoTopUpConfigResponse> {
    const res = await this.request('GET', '/functions/v1/auto-topup/config');
    return (await res.json()) as AutoTopUpConfigResponse;
  }

  /**
   * Update the authenticated user's auto-top-up configuration.
   *
   * Accepts partial updates -- only provided fields are changed.
   * Returns the full updated configuration.
   */
  async updateAutoTopUpConfig(
    config: UpdateAutoTopUpConfigParams,
  ): Promise<AutoTopUpConfigResponse> {
    const res = await this.request('PUT', '/functions/v1/auto-topup/config', config);
    return (await res.json()) as AutoTopUpConfigResponse;
  }

  /**
   * Fetch usage statistics for the authenticated user.
   *
   * Calls the usage-stats edge function with an optional period parameter.
   * Returns aggregated summaries, per-model breakdowns, daily trends,
   * and per-operation distributions.
   */
  async getUsageStats(period?: '7d' | '30d' | '90d'): Promise<UsageStats> {
    const queryPeriod = period ?? '30d';
    const path = `/functions/v1/usage-stats?period=${encodeURIComponent(queryPeriod)}`;
    const res = await this.request('GET', path);
    return (await res.json()) as UsageStats;
  }

  /**
   * Fetch debug information for a specific generation job.
   *
   * Returns the job record, associated credit transactions,
   * webhook delivery history, and any dead-letter entries for
   * troubleshooting failed or stuck jobs.
   */
  async getJobDebugInfo(jobId: string): Promise<JobDebugInfo> {
    const res = await this.request('GET', `/functions/v1/health-status?action=debug_job&job_id=${encodeURIComponent(jobId)}`);
    return (await res.json()) as JobDebugInfo;
  }

  /**
   * Fetch credit debug information for the authenticated user.
   *
   * Returns the current balance, full transaction history, and
   * reconciliation status comparing the expected balance (computed
   * from transaction log) against the actual stored balance.
   */
  async getCreditDebugInfo(): Promise<CreditDebugInfo> {
    const res = await this.request('GET', '/functions/v1/health-status?action=debug_credits');
    return (await res.json()) as CreditDebugInfo;
  }

  /**
   * Send an authenticated request to the API.
   */
  private async request(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = 30_000,
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };

    if (this.anonKey) {
      headers['apikey'] = this.anonKey;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const init: RequestInit = { method, headers, signal: controller.signal };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new CLIError(`Request timed out after ${timeoutMs / 1000}s`, {
          code: 'REQUEST_TIMEOUT',
          suggestion: 'Check your network connection and try again.',
        });
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      await throwApiError(res, `API request failed: ${method} ${path}`);
    }

    return res;
  }

  /**
   * Send a public (unauthenticated) request — only uses anon key.
   */
  private async requestPublic(method: string, path: string): Promise<Response> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.anonKey) {
      headers['apikey'] = this.anonKey;
      headers['Authorization'] = `Bearer ${this.anonKey}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    let res: Response;
    try {
      res = await fetch(url, { method, headers, signal: controller.signal });
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new CLIError('Request timed out after 15s', {
          code: 'REQUEST_TIMEOUT',
          suggestion: 'Check your network connection and try again.',
        });
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      await throwApiError(res, `API request failed: ${method} ${path}`);
    }

    return res;
  }
}

/**
 * Parse an error response from the API and throw a CLIError.
 */
async function throwApiError(res: Response, fallbackMessage: string): Promise<never> {
  let message = fallbackMessage;
  let code = `HTTP_${res.status}`;
  let suggestion: string | undefined;

  try {
    const body = (await res.json()) as ApiErrorBody;
    // Prefer error_description (human-readable) over error (code-like)
    if (body.error_description) {
      message = body.error_description;
    } else if (body.error) {
      message = body.error;
    }
    if (body.code) code = body.code;
    if (body.error && !body.code) code = body.error;
    if (body.suggestion) suggestion = body.suggestion;
  } catch {
    // Response body was not JSON -- use fallback
  }

  if (res.status === 401) {
    throw new CLIError(message, {
      code: 'AUTH_UNAUTHORIZED',
      suggestion: 'Run `agent-media login` to authenticate.',
    });
  }

  if (res.status === 402) {
    throw new CLIError(message, {
      code: 'INSUFFICIENT_CREDITS',
      suggestion: 'Buy credits at https://agent-media.ai/billing',
    });
  }

  if (res.status === 429) {
    throw new CLIError(message, {
      code: 'RATE_LIMITED',
      suggestion: 'Wait a moment and try again, or upgrade your plan.',
    });
  }

  throw new CLIError(message, { code, suggestion });
}
