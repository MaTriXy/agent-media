// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Error handling utilities for the agent-media CLI.
 */

import chalk from 'chalk';

/**
 * Structured CLI error with an error code and optional suggestion.
 */
export class CLIError extends Error {
  readonly code: string;
  readonly suggestion?: string;

  constructor(message: string, options: { code: string; suggestion?: string }) {
    super(message);
    this.name = 'CLIError';
    this.code = options.code;
    this.suggestion = options.suggestion;
  }
}

/**
 * Display a user-friendly error message and exit.
 *
 * - CLIError: shows code, message, and optional suggestion.
 * - Generic Error: shows the message with contextual suggestion.
 * - Unknown: shows a generic message with troubleshooting hint.
 */
export function handleError(error: unknown): never {
  if (error instanceof CLIError) {
    console.error(chalk.red(`\u2717 ${error.message}`));
    if (error.suggestion) {
      console.error(chalk.yellow(`  \u2192 ${error.suggestion}`));
    }
    console.error(chalk.dim(`  Error code: ${error.code}`));
    process.exit(1);
  }

  if (error instanceof Error) {
    console.error(chalk.red(`\u2717 ${error.message}`));

    // Provide contextual suggestions for common generic error types
    const suggestion = inferSuggestion(error);
    if (suggestion) {
      console.error(chalk.yellow(`  \u2192 ${suggestion}`));
    }

    console.error(chalk.dim(`  Error code: UNEXPECTED_ERROR`));
    process.exit(1);
  }

  console.error(chalk.red('\u2717 An unexpected error occurred.'));
  console.error(chalk.yellow(`  \u2192 Run 'agent-media doctor' to diagnose common issues.`));
  console.error(chalk.dim(`  Error code: UNKNOWN_ERROR`));
  process.exit(1);
}

/**
 * Infer a helpful suggestion from a generic Error based on common patterns.
 */
function inferSuggestion(error: Error): string | null {
  const msg = error.message.toLowerCase();

  // Network / fetch failures
  if (msg.includes('fetch') || msg.includes('enotfound') || msg.includes('econnrefused')) {
    return "Check your internet connection or run 'agent-media doctor' to verify API connectivity.";
  }

  // Timeout
  if (msg.includes('timeout') || msg.includes('aborted') || error.name === 'AbortError') {
    return 'The request timed out. Check your network or try again later.';
  }

  // Permission denied
  if (msg.includes('eacces') || msg.includes('permission denied')) {
    return 'Check file permissions. You may need to run with elevated privileges.';
  }

  // File system
  if (msg.includes('enoent') || msg.includes('no such file')) {
    return 'A required file or directory was not found. Check the path and try again.';
  }

  // JSON parse errors
  if (msg.includes('json') && (msg.includes('parse') || msg.includes('unexpected token'))) {
    return 'Received an invalid response. The API may be temporarily unavailable.';
  }

  return "Run 'agent-media doctor' to diagnose common issues.";
}
