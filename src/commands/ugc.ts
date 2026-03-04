// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * `agent-media ugc <script-or-file>` command.
 *
 * Produces a full UGC-style video from a script. Flow:
 * 1. Load API key from the credential store.
 * 2. If argument is a file (.txt/.md), read its contents; else use as inline script.
 * 3. POST to ugc-video edge function.
 * 4. Optionally wait for completion (--sync) and print output URL.
 */

import { readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { extname, resolve } from 'node:path';
import type { Command } from 'commander';
import chalk from 'chalk';
import {
  detectOutputMode,
  printJson,
  printQuiet,
  createSpinner,
} from '../lib/output.js';
import { getApiKey, resolveProfileName } from '../lib/credentials.js';
import {
  AgentMediaAPI,
  type GenerationJob,
} from '../lib/api.js';
import { CLIError, handleError } from '../lib/errors.js';
import type { OutputMode } from '../types.js';

/** Poll interval for --sync mode, in milliseconds. */
const POLL_INTERVAL_MS = 5_000;

/** Terminal job statuses that end the polling loop. */
const TERMINAL_STATUSES = new Set<string>(['completed', 'failed', 'canceled']);

/** Status labels with color coding. */
const STATUS_COLORS: Record<string, (text: string) => string> = {
  pending: chalk.yellow,
  processing: chalk.blue,
  submitted: chalk.blue,
  completed: chalk.green,
  failed: chalk.red,
  canceled: chalk.dim,
};

function formatStatus(status: string): string {
  const colorize = STATUS_COLORS[status] ?? chalk.white;
  return colorize(status.toUpperCase());
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

/** File extensions treated as script input files. */
const SCRIPT_EXTENSIONS = new Set(['.txt', '.md']);

/**
 * Check if the argument looks like a file path we should read.
 */
function isScriptFile(value: string): boolean {
  const ext = extname(value).toLowerCase();
  return SCRIPT_EXTENSIONS.has(ext) && existsSync(value);
}

/**
 * Poll a UGC job until it reaches a terminal state.
 */
async function waitForJob(
  api: AgentMediaAPI,
  jobId: string,
  mode: OutputMode,
): Promise<GenerationJob | null> {
  const startTime = Date.now();
  let interrupted = false;

  const onSigint = (): void => {
    interrupted = true;
  };
  process.on('SIGINT', onSigint);

  const spinner = createSpinner('Producing UGC video...');
  if (mode === 'human') spinner.start();

  try {
    while (!interrupted) {
      const poll = await api.pollProvider(jobId);
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const status = poll.status;

      if (mode === 'human') {
        // Show granular progress stage when available
        const checkpoint = (poll as { checkpoint?: string }).checkpoint;
        const stagePart = checkpoint && checkpoint !== 'processing'
          ? `  ${chalk.dim(checkpoint.replace(/_/g, ' '))}`
          : '';
        spinner.text = `${formatStatus(status)}${stagePart}  elapsed ${formatElapsed(elapsed)}  (Ctrl+C to stop)`;
      }

      if (TERMINAL_STATUSES.has(status)) {
        const job = await api.getJob(jobId);

        if (mode === 'human') {
          if (status === 'completed') {
            spinner.succeed(
              `UGC video produced in ${formatElapsed(elapsed)}`,
            );
          } else if (status === 'failed') {
            spinner.fail(
              `UGC job failed after ${formatElapsed(elapsed)}` +
                (job.error_message ? `: ${job.error_message}` : ''),
            );
          } else {
            spinner.warn(
              `UGC job canceled after ${formatElapsed(elapsed)}`,
            );
          }
        }

        return job;
      }

      await new Promise<void>((resolve) => {
        const earlyExit = (): void => {
          clearTimeout(timer);
          process.removeListener('SIGINT', earlyExit);
          resolve();
        };
        const timer = setTimeout(() => {
          process.removeListener('SIGINT', earlyExit);
          resolve();
        }, POLL_INTERVAL_MS);
        process.once('SIGINT', earlyExit);
      });
    }

    if (mode === 'human') {
      spinner.stop();
      console.log();
      console.log(chalk.dim('  Stopped waiting.'));
    }

    return null;
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
}

/**
 * Prompt the user for confirmation via readline.
 * Returns true if the user confirms (Y/y/Enter), false otherwise.
 */
function askConfirmation(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      resolve(trimmed === '' || trimmed === 'y' || trimmed === 'yes');
    });
  });
}

export function registerUGCCommand(program: Command): void {
  program
    .command('ugc [script-or-file]')
    .description(
      'Produce a UGC-style video from a script\n\n' +
      'Examples:\n' +
      '  $ agent-media ugc "Ever wonder why top founders wake up at 5am?" --sync\n' +
      '  $ agent-media ugc ./script.txt --voice nova --sync\n' +
      '  $ agent-media ugc ./script.md --style hormozi -s\n' +
      '  $ agent-media ugc -g "A fitness tracker that monitors sleep quality" --sync\n' +
      '  $ agent-media ugc -g "Premium yoga mat" --product-url https://example.com/mat\n' +
      '  $ agent-media ugc ./script.txt --scenes-file ./scenes.json --sync\n' +
      '  $ agent-media ugc ./script.txt --product-image https://example.com/product.jpg --sync\n\n' +
      'The argument can be inline text or a path to a .txt/.md file.\n' +
      'Use --generate-script to have AI write the script for you.\n' +
      'Use --scenes-file to provide a JSON array of scenes and bypass AI scene splitting.\n' +
      'Scenes file format: [{"type":"talking_head","text":"..."},{"type":"broll","text":"...","visual_prompt":"..."}]',
    )
    .option('--voice <name>', 'TTS voice (alloy, echo, fable, onyx, nova, shimmer, or custom voice_id)')
    .option('--tone <name>', 'Voice tone: energetic, calm, confident, dramatic')
    .option('--model <name>', 'B-roll model (default: kling3)', 'kling3')
    .option('--style <name>', 'Subtitle style: hormozi, minimal, bold, karaoke, clean, tiktok, neon (default: hormozi)', 'hormozi')
    .option('--persona <slug>', 'Use a persona for voice + face consistency (created via `agent-media persona create`)')
    .option('--actor <slug>', 'Use a library actor for talking heads (see `agent-media actor list`)')
    .option('--face-url <url>', 'Direct URL or local file path to a face photo for talking head + B-roll')
    .option('-d, --duration <seconds>', 'Target video duration in seconds (5, 10, 15)', parseInt)
    .option('--aspect <ratio>', 'Aspect ratio: 9:16, 16:9, 1:1 (default: 9:16)', '9:16')
    .option('--music <genre>', 'Background music: chill, energetic, corporate, dramatic, upbeat')
    .option('--cta <text>', 'End screen call-to-action text (max 100 chars)')
    .option('-g, --generate-script <prompt>', 'Generate a UGC script from a one-line product description')
    .option('--product-url <url>', 'Product URL to scrape for script generation (used with --generate-script)')
    .option('--tts-provider <name>', 'TTS provider override: openai, elevenlabs, or hume (default: auto-detect)')
    .option('--broll', 'Allow B-roll cutaway scenes (actor + voiceover mix)')
    .option('--broll-images <urls>', 'Comma-separated image URLs or local file paths for B-roll (one per scene, in order)')
    .option('--dub-language <code>', 'Dub the final video into this language (BCP-47 code, e.g. es, fr, de, pt)')
    .option('--scenes-file <path>', 'JSON file with explicit per-scene control (bypasses AI scene splitting)')
    .option('--product-image <url>', 'Product image URL used as default B-roll reference (face photo still drives talking heads)')
    .option('--template <slug>', 'Script structure template: monologue, testimonial, product-review, problem-solution, saas-review, before-after, listicle, product-demo')
    .option('--broll-model <slug>', 'B-roll video model: kling3 (default), hailuo2, wan21')
    .option('--voice-speed <n>', 'TTS speed multiplier (0.7–1.5, default: 1.0)', parseFloat)
    .option('-s, --sync', 'Wait for completion and print the output URL')
    .action(async (scriptOrFile: string | undefined, cmdOpts: { voice?: string; tone?: string; model: string; style: string; persona?: string; actor?: string; faceUrl?: string; duration?: number; aspect: string; music?: string; cta?: string; generateScript?: string; productUrl?: string; ttsProvider?: string; broll?: boolean; brollImages?: string; dubLanguage?: string; scenesFile?: string; productImage?: string; template?: string; brollModel?: string; voiceSpeed?: number; sync?: boolean }) => {
      const globalOpts = program.opts<{
        json?: boolean;
        quiet?: boolean;
        profile?: string;
      }>();
      const mode = detectOutputMode(globalOpts);
      const profileName = resolveProfileName(globalOpts.profile);
      const apiKey = getApiKey(profileName);

      if (!apiKey) {
        throw new CLIError('Not logged in.', {
          code: 'NOT_AUTHENTICATED',
          suggestion: "Run 'agent-media login' to authenticate.",
        });
      }

      try {
        const api = new AgentMediaAPI(apiKey);

        // ── Resolve script content ──────────────────────────────────────
        let script: string;
        let useGenerateScript = false;

        if (cmdOpts.generateScript) {
          // AI Script Generation mode: -g "product description"
          useGenerateScript = true;
          script = ''; // Script will be generated server-side
          if (mode === 'human') {
            console.log(`  ${chalk.yellow('AI Script Generation')} enabled`);
            console.log(`  Prompt: ${chalk.cyan(cmdOpts.generateScript)}`);
            if (cmdOpts.productUrl) {
              console.log(`  Product URL: ${chalk.cyan(cmdOpts.productUrl)}`);
            }
          }
        } else if (!scriptOrFile && !cmdOpts.scenesFile) {
          throw new CLIError(
            'Script argument is required (or use -g to generate one, or --scenes-file for explicit scenes).',
            {
              code: 'INVALID_INPUT',
              suggestion: "Provide a script: agent-media ugc 'your script...' --sync\nOr generate one: agent-media ugc -g 'fitness tracker' --sync\nOr use scenes: agent-media ugc --scenes-file ./scenes.json --sync",
            },
          );
        } else if (!scriptOrFile && cmdOpts.scenesFile) {
          // scenes-file provided without a script — derive script from scene texts for duration estimation
          script = ''; // will be filled after scenes are parsed below
        } else if (isScriptFile(scriptOrFile!)) {
          script = readFileSync(scriptOrFile!, 'utf-8').trim();
          if (mode === 'human') {
            console.log(`  Reading script from ${chalk.cyan(scriptOrFile!)} (${script.length} chars)`);
          }
        } else {
          script = scriptOrFile!.trim();
        }

        // Only validate script length when not generating and not using scenes-file
        if (!useGenerateScript && !cmdOpts.scenesFile) {
          if (script.length < 50) {
            throw new CLIError(
              `Script too short (${script.length} chars). Minimum is 50 characters.`,
              {
                code: 'INVALID_INPUT',
                suggestion: 'Provide a longer script or check the file contents.',
              },
            );
          }

          if (script.length > 3000) {
            throw new CLIError(
              `Script too long (${script.length} chars). Maximum is 3000 characters.`,
              {
                code: 'INVALID_INPUT',
                suggestion: 'Shorten the script to under 3000 characters.',
              },
            );
          }
        }

        // ── Submit UGC job ──────────────────────────────────────────────
        const submitSpinner = createSpinner('Submitting UGC job...');
        if (mode === 'human') submitSpinner.start();

        const ugcParams: import('../lib/api.js').UGCGenerateParams = {
          script: useGenerateScript ? '' : script,
          ...(cmdOpts.voice ? { voice: cmdOpts.voice } : {}),
          model: cmdOpts.model,
          style: cmdOpts.style,
          aspect_ratio: cmdOpts.aspect as '9:16' | '16:9' | '1:1',
        };

        if (useGenerateScript) {
          ugcParams.generate_script = true;
          ugcParams.script_prompt = cmdOpts.generateScript;
          if (cmdOpts.productUrl) {
            ugcParams.product_url = cmdOpts.productUrl;
          }
        }

        if (cmdOpts.ttsProvider) {
          const validProviders = ['openai', 'elevenlabs', 'hume'];
          if (!validProviders.includes(cmdOpts.ttsProvider)) {
            throw new CLIError(
              `Invalid TTS provider '${cmdOpts.ttsProvider}'. Must be: openai, elevenlabs, or hume`,
              { code: 'INVALID_INPUT' },
            );
          }
          ugcParams.tts_provider = cmdOpts.ttsProvider as 'openai' | 'elevenlabs' | 'hume';
        }

        if (cmdOpts.tone) {
          const validTones = ['energetic', 'calm', 'confident', 'dramatic'];
          if (!validTones.includes(cmdOpts.tone)) {
            throw new CLIError(
              `Invalid tone '${cmdOpts.tone}'. Must be one of: ${validTones.join(', ')}`,
              { code: 'INVALID_INPUT' },
            );
          }
          ugcParams.tone = cmdOpts.tone;
          if (mode === 'human') {
            console.log(`  Tone:    ${chalk.cyan(cmdOpts.tone)}`);
          }
        }

        if (cmdOpts.music) {
          const validGenres = ['chill', 'energetic', 'corporate', 'dramatic', 'upbeat'];
          if (!validGenres.includes(cmdOpts.music)) {
            throw new CLIError(
              `Invalid music genre '${cmdOpts.music}'. Must be one of: ${validGenres.join(', ')}`,
              { code: 'INVALID_INPUT', suggestion: 'Use --music chill for a chill background track.' },
            );
          }
          ugcParams.music = cmdOpts.music;
          if (mode === 'human') {
            console.log(`  Music:   ${chalk.cyan(cmdOpts.music)}`);
          }
        }

        if (cmdOpts.cta) {
          if (cmdOpts.cta.length > 100) {
            throw new CLIError(
              `CTA text too long (${cmdOpts.cta.length} chars). Maximum is 100 characters.`,
              { code: 'INVALID_INPUT' },
            );
          }
          ugcParams.cta = cmdOpts.cta;
          if (mode === 'human') {
            console.log(`  CTA:     ${chalk.cyan(cmdOpts.cta)}`);
          }
        }

        if (cmdOpts.aspect && cmdOpts.aspect !== '9:16') {
          const validRatios = ['9:16', '16:9', '1:1'];
          if (!validRatios.includes(cmdOpts.aspect)) {
            throw new CLIError(
              `Invalid aspect ratio '${cmdOpts.aspect}'. Must be one of: ${validRatios.join(', ')}`,
              { code: 'INVALID_INPUT', suggestion: 'Use --aspect 16:9 for landscape output.' },
            );
          }
          if (mode === 'human') {
            console.log(`  Aspect:  ${chalk.cyan(cmdOpts.aspect)}`);
          }
        }

        if (cmdOpts.duration) {
          const validDurations = [5, 10, 15];
          if (!validDurations.includes(cmdOpts.duration)) {
            throw new CLIError(
              `Invalid duration ${cmdOpts.duration}s. Must be one of: ${validDurations.join(', ')}`,
              { code: 'INVALID_INPUT', suggestion: 'Use --duration 5 for a quick test, or --duration 15 for max.' },
            );
          }
          ugcParams.target_duration = cmdOpts.duration;
          if (mode === 'human') {
            console.log(`  Duration: ${chalk.cyan(cmdOpts.duration + 's')} target`);
          }
        }

        if (cmdOpts.persona) {
          ugcParams.persona_slug = cmdOpts.persona;
          if (mode === 'human') {
            console.log(`  Persona: ${chalk.cyan(cmdOpts.persona)}`);
          }
        }

        if (cmdOpts.actor) {
          // --actor conflicts with --face-url and --persona
          if (cmdOpts.faceUrl) {
            throw new CLIError('--actor and --face-url are mutually exclusive. Actor already includes a face photo.', { code: 'INVALID_INPUT' });
          }
          if (cmdOpts.persona) {
            throw new CLIError('--actor and --persona are mutually exclusive. Use one or the other.', { code: 'INVALID_INPUT' });
          }
          ugcParams.actor_slug = cmdOpts.actor;
          if (mode === 'human') {
            console.log(`  Actor:   ${chalk.cyan(cmdOpts.actor)}`);
          }
        }

        if (cmdOpts.brollImages) {
          const raw = cmdOpts.brollImages.split(',').map((u) => u.trim()).filter(Boolean);
          if (raw.length === 0) {
            throw new CLIError('--broll-images must contain at least one URL or file path', { code: 'INVALID_INPUT' });
          }
          const resolvedUrls: string[] = [];
          for (const entry of raw) {
            if (entry.startsWith('http://') || entry.startsWith('https://')) {
              resolvedUrls.push(entry);
            } else {
              // Local file — upload to Supabase Storage
              const filePath = resolve(entry);
              if (!existsSync(filePath)) {
                throw new CLIError(`B-roll image file not found: ${entry}`, {
                  code: 'INVALID_INPUT',
                  suggestion: 'Provide a valid file path or HTTP/HTTPS URL.',
                });
              }
              if (mode === 'human') {
                console.log(`  Uploading B-roll image: ${chalk.cyan(entry)}...`);
              }
              const fileBuffer = readFileSync(filePath);
              const ext = extname(filePath).toLowerCase();
              const contentType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
              const filename = `broll-${resolvedUrls.length}${ext || '.png'}`;
              const uploadInfo = await api.getUploadUrl(filename, contentType);
              await api.uploadFile(uploadInfo.upload_url, fileBuffer.buffer as ArrayBuffer, contentType);
              resolvedUrls.push(`${api.baseUrl}/storage/v1/object/public/generation-inputs/${uploadInfo.storage_path}`);
            }
          }
          ugcParams.broll_images = resolvedUrls;
          if (mode === 'human') {
            console.log(`  B-roll:  ${chalk.cyan(resolvedUrls.length + ' custom image(s)')}`);
          }
        }

        if (cmdOpts.dubLanguage) {
          ugcParams.dub_language = cmdOpts.dubLanguage;
          if (mode === 'human') {
            console.log(`  Dub:     ${chalk.cyan(cmdOpts.dubLanguage)}`);
          }
        }

        if (cmdOpts.scenesFile) {
          const scenesPath = resolve(cmdOpts.scenesFile);
          if (!existsSync(scenesPath)) {
            throw new CLIError(`Scenes file not found: ${scenesPath}`, { code: 'INVALID_INPUT' });
          }
          let scenesData: unknown;
          try {
            scenesData = JSON.parse(readFileSync(scenesPath, 'utf-8'));
          } catch {
            throw new CLIError(`Failed to parse scenes file as JSON: ${scenesPath}`, { code: 'INVALID_INPUT' });
          }
          if (!Array.isArray(scenesData) || scenesData.length === 0) {
            throw new CLIError('Scenes file must be a non-empty JSON array', { code: 'INVALID_INPUT' });
          }
          for (const s of scenesData as unknown[]) {
            const scene = s as Record<string, unknown>;
            if (!scene['text'] || typeof scene['text'] !== 'string') {
              throw new CLIError('Each scene must have a "text" field', { code: 'INVALID_INPUT' });
            }
            if (scene['type'] && scene['type'] !== 'talking_head' && scene['type'] !== 'broll') {
              throw new CLIError(`Invalid scene type "${scene['type']}". Must be "talking_head" or "broll"`, { code: 'INVALID_INPUT' });
            }
          }
          ugcParams.scenes = scenesData as Array<{ type: string; text: string; visual_prompt?: string; image?: string }>;
          // Derive script from scene texts if not provided (for duration estimation server-side)
          if (!ugcParams.script) {
            ugcParams.script = (scenesData as Array<{ text: string }>).map((s) => s.text).join(' ');
          }
          if (mode === 'human') {
            console.log(`  Scenes:  ${chalk.cyan((scenesData as unknown[]).length + ' scenes from ' + cmdOpts.scenesFile)}`);
          }
        }

        if (cmdOpts.productImage) {
          if (!cmdOpts.productImage.startsWith('http://') && !cmdOpts.productImage.startsWith('https://')) {
            throw new CLIError(
              `--product-image must be an HTTP/HTTPS URL. Got: ${cmdOpts.productImage}`,
              { code: 'INVALID_INPUT', suggestion: 'Upload the image first or use a public URL.' },
            );
          }
          ugcParams.product_image_url = cmdOpts.productImage;
          if (mode === 'human') {
            console.log(`  Product: ${chalk.cyan(cmdOpts.productImage.substring(0, 60))}...`);
          }
        }

        if (cmdOpts.template) {
          const validTemplates = [
            'monologue', 'testimonial', 'product-review', 'problem-solution',
            'saas-review', 'before-after', 'listicle', 'product-demo',
          ];
          if (!validTemplates.includes(cmdOpts.template)) {
            throw new CLIError(
              `Invalid template '${cmdOpts.template}'. Must be one of: ${validTemplates.join(', ')}`,
              { code: 'INVALID_INPUT' },
            );
          }
          ugcParams.template = cmdOpts.template;
          if (mode === 'human') {
            console.log(`  Template: ${chalk.cyan(cmdOpts.template)}`);
          }
        }

        if (cmdOpts.broll) {
          ugcParams.allow_broll = true;
          if (mode === 'human') {
            console.log(`  B-roll:   ${chalk.cyan('enabled (mixed talking head + cutaways)')}`);
          }
        }

        if (cmdOpts.brollModel) {
          const validModels = ['kling3', 'hailuo2', 'wan21'];
          if (!validModels.includes(cmdOpts.brollModel)) {
            throw new CLIError(
              `Invalid broll-model '${cmdOpts.brollModel}'. Must be one of: ${validModels.join(', ')}`,
              { code: 'INVALID_INPUT' },
            );
          }
          ugcParams.broll_model = cmdOpts.brollModel;
          if (mode === 'human') {
            console.log(`  B-roll:   ${chalk.cyan(cmdOpts.brollModel)}`);
          }
        }

        if (cmdOpts.voiceSpeed != null) {
          if (cmdOpts.voiceSpeed < 0.7 || cmdOpts.voiceSpeed > 1.5) {
            throw new CLIError(
              `Invalid voice-speed ${cmdOpts.voiceSpeed}. Must be between 0.7 and 1.5`,
              { code: 'INVALID_INPUT' },
            );
          }
          ugcParams.voice_speed = cmdOpts.voiceSpeed;
          if (mode === 'human') {
            console.log(`  Speed:    ${chalk.cyan(cmdOpts.voiceSpeed + 'x')}`);
          }
        }

        if (cmdOpts.faceUrl) {
          let faceUrl = cmdOpts.faceUrl;

          // If it's a local file, upload to Supabase Storage first
          if (!faceUrl.startsWith('http://') && !faceUrl.startsWith('https://')) {
            if (!existsSync(faceUrl)) {
              throw new CLIError(`Face photo file not found: ${faceUrl}`, {
                code: 'INVALID_INPUT',
                suggestion: 'Provide a valid file path or URL.',
              });
            }
            if (mode === 'human') {
              console.log(`  Uploading face photo: ${chalk.cyan(faceUrl)}...`);
            }
            const fileBuffer = readFileSync(faceUrl);
            const ext = extname(faceUrl).toLowerCase();
            const contentType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
            const filename = `face-photo${ext || '.png'}`;
            const uploadInfo = await api.getUploadUrl(filename, contentType);
            await api.uploadFile(uploadInfo.upload_url, fileBuffer.buffer as ArrayBuffer, contentType);
            // Construct public URL from storage path
            faceUrl = `${api.baseUrl}/storage/v1/object/public/generation-inputs/${uploadInfo.storage_path}`;
          }

          ugcParams.face_photo_url = faceUrl;
          if (mode === 'human') {
            console.log(`  Face:    ${chalk.cyan(faceUrl.substring(0, 60))}...`);
          }
        }

        const result = await api.ugcGenerate(ugcParams);

        if (mode === 'human') submitSpinner.succeed('UGC job submitted');

        // Display voice auto-detection
        if (result.voice_auto_detected && result.selected_voice && mode === 'human') {
          console.log(`  ${chalk.dim('Voice auto-detected from face photo:')} ${chalk.cyan(result.selected_voice)}`);
        }

        // Display generated script if applicable
        if (result.generated_script && mode === 'human') {
          console.log();
          console.log(`  ${chalk.yellow('Generated Script:')}`);
          console.log(`  ${chalk.dim('─'.repeat(60))}`);
          for (const line of result.generated_script.split('\n')) {
            console.log(`  ${line}`);
          }
          console.log(`  ${chalk.dim('─'.repeat(60))}`);
          console.log();
        }

        const shouldWait = !!cmdOpts.sync;

        // ── Output result ───────────────────────────────────────────────
        if (!shouldWait) {
          switch (mode) {
            case 'json':
              printJson({
                job_id: result.job_id,
                status: result.status,
                estimated_duration: result.estimated_duration,
                credits_deducted: result.credits_deducted,
              });
              break;

            case 'quiet':
              printQuiet(result.job_id);
              break;

            default:
              console.log();
              console.log(
                `  ${chalk.bold('Job ID:')}     ${chalk.cyan(result.job_id)}`,
              );
              console.log(
                `  ${chalk.bold('Status:')}     ${chalk.yellow(result.status)}`,
              );
              console.log(
                `  ${chalk.bold('Duration:')}   ~${result.estimated_duration}s estimated`,
              );
              console.log(
                `  ${chalk.bold('Credits:')}    ${result.credits_deducted} deducted`,
              );
              console.log();
              console.log(
                chalk.dim(
                  `  Run 'agent-media status ${result.job_id}' to check progress`,
                ),
              );
              console.log(
                chalk.dim(
                  `  Or use --sync to wait for completion`,
                ),
              );
              console.log();
              break;
          }
          return;
        }

        // ── Wait for completion (--sync) ────────────────────────────────
        if (mode === 'human') {
          console.log();
          console.log(
            `  ${chalk.bold('Job ID:')}     ${chalk.cyan(result.job_id)}`,
          );
          console.log(
            `  ${chalk.bold('Duration:')}   ~${result.estimated_duration}s estimated`,
          );
          console.log(
            `  ${chalk.bold('Credits:')}    ${result.credits_deducted} deducted`,
          );
          console.log();
        }

        const finishedJob = await waitForJob(api, result.job_id, mode);

        if (!finishedJob) return;

        if (mode === 'json') {
          const payload: Record<string, unknown> = {
            job_id: finishedJob.id,
            status: finishedJob.status,
            credits_deducted: result.credits_deducted,
          };
          if (finishedJob.status === 'failed') {
            payload['error'] = finishedJob.error_message ?? 'Unknown error';
          }
          if (finishedJob.output_media_url) {
            payload['output_url'] = finishedJob.output_media_url;
          }
          printJson(payload);
          return;
        }

        if (mode === 'quiet') {
          printQuiet(finishedJob.output_media_url ?? finishedJob.id);
          return;
        }

        if (finishedJob.status === 'completed' && finishedJob.output_media_url) {
          console.log();
          console.log(
            `  ${chalk.bold('URL:')}  ${chalk.cyan(finishedJob.output_media_url)}`,
          );
          console.log();
        } else if (finishedJob.status !== 'completed') {
          console.log();
          console.log(
            chalk.yellow('  No output -- UGC job did not complete successfully.'),
          );
          console.log();
        }
      } catch (error: unknown) {
        handleError(error);
      }
    });
}
