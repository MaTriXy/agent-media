// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * `agent-media update` command.
 *
 * Checks the npm registry for the latest published version of the
 * agent-media package, compares it against the locally installed version,
 * and optionally offers to install the update.
 *
 * Flags:
 *   --check   Check-only mode (do not prompt or install).
 */

import type { Command } from 'commander';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import { detectOutputMode, printJson, printQuiet, createSpinner } from '../lib/output.js';
import { CLIError, handleError } from '../lib/errors.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { name: string; version: string };

/** npm registry URL for the package. */
const REGISTRY_URL = `https://registry.npmjs.org/${pkg.name}/latest`;

/** Timeout for the registry fetch (5 seconds). */
const FETCH_TIMEOUT_MS = 5_000;

/**
 * Compare two semver strings. Returns:
 *  -1 if a < b, 0 if equal, 1 if a > b.
 */
function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

/**
 * Fetch the latest version string from the npm registry.
 */
async function fetchLatestVersion(): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(REGISTRY_URL, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      throw new CLIError(
        `Failed to check for updates (HTTP ${res.status})`,
        {
          code: 'REGISTRY_ERROR',
          suggestion: 'Check your network connection or try again later.',
        },
      );
    }

    const data = (await res.json()) as { version?: string };

    if (!data.version) {
      throw new CLIError('Unexpected response from npm registry.', {
        code: 'REGISTRY_PARSE_ERROR',
        suggestion: 'Try again later or check https://www.npmjs.com/package/agent-media-cli manually.',
      });
    }

    return data.version;
  } catch (error: unknown) {
    if (error instanceof CLIError) throw error;

    if (error instanceof Error && error.name === 'AbortError') {
      throw new CLIError('Timed out checking for updates.', {
        code: 'REGISTRY_TIMEOUT',
        suggestion: 'Check your network connection or try again later.',
      });
    }

    throw new CLIError('Failed to check for updates.', {
      code: 'REGISTRY_ERROR',
      suggestion: 'Check your network connection or try again later.',
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Detect the package manager used to install the CLI globally.
 *
 * Checks for common indicators. Falls back to npm.
 */
function detectPackageManager(): 'pnpm' | 'npm' | 'yarn' {
  try {
    const npmGlobalRoot = execSync('npm root -g', { encoding: 'utf-8' }).trim();
    if (npmGlobalRoot && process.argv[1]?.includes(npmGlobalRoot)) {
      return 'npm';
    }
  } catch {
    // ignore
  }

  try {
    execSync('pnpm --version', { encoding: 'utf-8', stdio: 'pipe' });
    return 'pnpm';
  } catch {
    // ignore
  }

  return 'npm';
}

/**
 * Build the install command string for the detected package manager.
 */
function buildInstallCommand(pm: 'pnpm' | 'npm' | 'yarn', version: string): string {
  const spec = `${pkg.name}@${version}`;

  switch (pm) {
    case 'pnpm':
      return `pnpm add -g ${spec}`;
    case 'yarn':
      return `yarn global add ${spec}`;
    default:
      return `npm install -g ${spec}`;
  }
}

export function registerUpdateCommand(program: Command): void {
  program
    .command('update')
    .description('Check for and install CLI updates')
    .option('--check', 'Check only, do not install')
    .action(async (cmdOpts: { check?: boolean }) => {
      const globalOpts = program.opts<{
        json?: boolean;
        quiet?: boolean;
      }>();
      const mode = detectOutputMode(globalOpts);
      const checkOnly = cmdOpts.check ?? false;

      try {
        const spinner = createSpinner('Checking for updates...');
        if (mode === 'human') spinner.start();

        const latestVersion = await fetchLatestVersion();
        const currentVersion = pkg.version;
        const comparison = compareSemver(currentVersion, latestVersion);

        if (mode === 'human') spinner.stop();

        // Already up to date
        if (comparison >= 0) {
          switch (mode) {
            case 'json':
              printJson({
                current: currentVersion,
                latest: latestVersion,
                update_available: false,
              });
              break;

            case 'quiet':
              printQuiet(currentVersion);
              break;

            default:
              console.log();
              console.log(
                `  ${chalk.green('Up to date!')} agent-media v${currentVersion} is the latest version.`,
              );
              console.log();
              break;
          }
          return;
        }

        // Update available
        const pm = detectPackageManager();
        const installCmd = buildInstallCommand(pm, latestVersion);

        switch (mode) {
          case 'json':
            printJson({
              current: currentVersion,
              latest: latestVersion,
              update_available: true,
              install_command: installCmd,
            });
            break;

          case 'quiet':
            printQuiet(latestVersion);
            break;

          default: {
            console.log();
            console.log(chalk.bold('  Update available!'));
            console.log();
            console.log(
              `  ${chalk.dim('Current:')}  v${currentVersion}`,
            );
            console.log(
              `  ${chalk.green('Latest:')}   v${latestVersion}`,
            );
            console.log();

            if (checkOnly) {
              console.log(
                `  Run the following to update:`,
              );
              console.log();
              console.log(`    ${chalk.cyan(installCmd)}`);
              console.log();
              return;
            }

            // Attempt to install the update
            console.log(
              `  Installing update via ${pm}...`,
            );
            console.log();

            const installSpinner = createSpinner(`Running: ${installCmd}`);
            installSpinner.start();

            try {
              execSync(installCmd, {
                encoding: 'utf-8',
                stdio: 'pipe',
              });

              installSpinner.succeed(
                `Updated agent-media from v${currentVersion} to v${latestVersion}`,
              );
              console.log();
            } catch (installError: unknown) {
              installSpinner.fail('Installation failed');
              const msg = installError instanceof Error ? installError.message : String(installError);
              throw new CLIError(`Failed to install update: ${msg}`, {
                code: 'UPDATE_INSTALL_FAILED',
                suggestion: `Try installing manually:\n  ${installCmd}`,
              });
            }
            break;
          }
        }
      } catch (error: unknown) {
        handleError(error);
      }
    });
}
