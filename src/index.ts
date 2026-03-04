#!/usr/bin/env node

// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * agent-media CLI entry point.
 *
 * Unified command-line interface for AI-powered video and image generation.
 */

import { Command } from 'commander';
import { createRequire } from 'node:module';
import { registerVersionCommand } from './commands/version.js';
import { registerLoginCommand } from './commands/login.js';
import { registerLogoutCommand } from './commands/logout.js';
import { registerWhoAmICommand } from './commands/whoami.js';
import { registerCreditsCommand } from './commands/credits.js';
import { registerPlanCommand } from './commands/plan.js';
import { registerConfigCommand } from './commands/config.js';
import { registerStatusCommand } from './commands/status.js';
import { registerDownloadCommand } from './commands/download.js';
import { registerListCommand } from './commands/list.js';
import { registerProfileCommand } from './commands/profile.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerInspectCommand } from './commands/inspect.js';
import { registerDeleteCommand } from './commands/delete.js';
import { registerCancelCommand } from './commands/cancel.js';
import { registerApikeyCommand } from './commands/apikey.js';
import { registerUsageCommand } from './commands/usage.js';
import { registerSubscribeCommand } from './commands/subscribe.js';
import { registerDebugCommand } from './commands/debug.js';
import { registerAliasCommand } from './commands/alias.js';
import { registerUpdateCommand } from './commands/update.js';
import { registerCompletionsCommand } from './commands/completions.js';
import { registerSubtitleCommand } from './commands/subtitle.js';
import { registerUGCCommand } from './commands/ugc.js';
import { registerPersonaCommand } from './commands/persona.js';
import { registerActorCommand } from './commands/actor.js';
import { registerReviewCommand } from './commands/review.js';
import { handleError } from './lib/errors.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string; description: string };

const program = new Command();

program
  .name('agent-media')
  .description(pkg.description)
  .version(pkg.version, '-V, --version', 'Show CLI version')
  .option('--json', 'Output as JSON (for scripting/piping)')
  .option('--quiet', 'Minimal output (for piping)')
  .option('--no-color', 'Disable colored output')
  .option('--verbose', 'Show debug output')
  .option('--profile <name>', 'Use a specific credential profile');

// Register commands
registerVersionCommand(program);
registerLoginCommand(program);
registerLogoutCommand(program);
registerWhoAmICommand(program);
registerCreditsCommand(program);
registerPlanCommand(program);
registerConfigCommand(program);
registerStatusCommand(program);
registerDownloadCommand(program);
registerListCommand(program);
registerProfileCommand(program);
registerDoctorCommand(program);
registerInspectCommand(program);
registerDeleteCommand(program);
registerCancelCommand(program);
registerApikeyCommand(program);
registerUsageCommand(program);
registerSubscribeCommand(program);
registerDebugCommand(program);
registerAliasCommand(program);
registerUpdateCommand(program);
registerCompletionsCommand(program);
registerSubtitleCommand(program);
registerUGCCommand(program);
registerPersonaCommand(program);
registerActorCommand(program);
registerReviewCommand(program);

// Parse and execute
try {
  program.parse();
} catch (error: unknown) {
  handleError(error);
}
