/**
 * Security module for Smart Connections MCP Server
 *
 * SECURITY INVARIANTS (must ALWAYS hold):
 * 1. Path Confinement - Never access files outside configured vault
 * 2. No Traversal - Block ../, symlink escapes, absolute paths
 * 3. File Type Restriction - Only .md files for content retrieval
 * 4. Fail Closed - On any error, deny access
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface Config {
  vaultPath: string;
  resolvedVaultPath: string; // Resolved at startup, used for all checks
  limits: {
    maxQueryLength: number;
    maxResults: number;
    maxContentLength: number;
  };
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  resolvedPath?: string;
}

/**
 * Validate and resolve the vault configuration at startup.
 * Fails fast if configuration is invalid.
 */
export function validateConfig(vaultPath: string | undefined): Config {
  // SECURITY: No implicit defaults - vault path must be explicit
  if (!vaultPath) {
    throw new Error('VAULT_PATH environment variable is required');
  }

  // SECURITY: Resolve to absolute path immediately
  const absolutePath = path.resolve(vaultPath);

  // SECURITY: Verify path exists
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Vault path does not exist: ${absolutePath}`);
  }

  // SECURITY: Verify it's a directory
  const stats = fs.statSync(absolutePath);
  if (!stats.isDirectory()) {
    throw new Error(`Vault path is not a directory: ${absolutePath}`);
  }

  // SECURITY: Block overly broad paths
  const homeDir = process.env.HOME || '/';
  if (absolutePath === '/' || absolutePath === homeDir) {
    throw new Error(`Vault path too broad (security risk): ${absolutePath}`);
  }

  // SECURITY: Verify Smart Connections is installed
  const smartEnvPath = path.join(absolutePath, '.smart-env');
  if (!fs.existsSync(smartEnvPath)) {
    throw new Error(
      `No .smart-env directory found at ${absolutePath}. ` +
      'Is Smart Connections plugin installed and has it built embeddings?'
    );
  }

  // SECURITY: Resolve symlinks to get canonical path for all future checks
  let resolvedVaultPath: string;
  try {
    resolvedVaultPath = fs.realpathSync(absolutePath);
  } catch {
    throw new Error(`Cannot resolve vault path: ${absolutePath}`);
  }

  return {
    vaultPath: absolutePath,
    resolvedVaultPath,
    limits: {
      maxQueryLength: 1000,
      maxResults: 50,
      maxContentLength: 10240, // 10KB per note
    },
  };
}

/**
 * Validate a note path for content retrieval.
 *
 * SECURITY: This is the critical path validation function.
 * It must block all path traversal attempts.
 */
export function validateNotePath(
  config: Config,
  relativePath: string
): ValidationResult {
  // SECURITY: Reject empty paths
  if (!relativePath || typeof relativePath !== 'string') {
    return { valid: false, error: 'Path is required' };
  }

  // SECURITY: Trim whitespace (could hide traversal)
  const trimmed = relativePath.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'Path cannot be empty' };
  }

  // SECURITY: Block absolute paths immediately
  if (path.isAbsolute(trimmed)) {
    logSecurityEvent('path_traversal_blocked', { reason: 'absolute_path', path: sanitizeForLog(trimmed) });
    return { valid: false, error: 'Absolute paths not allowed' };
  }

  // SECURITY: Normalize to handle . and .. components
  const normalized = path.normalize(trimmed);

  // SECURITY: Block if normalization results in traversal
  if (normalized.startsWith('..') || normalized.includes(`..${path.sep}`)) {
    logSecurityEvent('path_traversal_blocked', { reason: 'dot_dot', path: sanitizeForLog(trimmed) });
    return { valid: false, error: 'Path traversal not allowed' };
  }

  // SECURITY: Block hidden files/directories (could expose .env, .git, etc.)
  const parts = normalized.split(path.sep);
  for (const part of parts) {
    if (part.startsWith('.') && part !== '.') {
      logSecurityEvent('path_traversal_blocked', { reason: 'hidden_path', path: sanitizeForLog(trimmed) });
      return { valid: false, error: 'Hidden files/directories not accessible' };
    }
  }

  // SECURITY: Only allow .md files for content retrieval
  if (!normalized.toLowerCase().endsWith('.md')) {
    return { valid: false, error: 'Only .md files can be retrieved' };
  }

  // SECURITY: Construct full path and resolve
  const fullPath = path.join(config.resolvedVaultPath, normalized);

  let resolvedPath: string;
  try {
    // Check if file exists first
    if (!fs.existsSync(fullPath)) {
      return { valid: false, error: 'Note not found' };
    }
    // SECURITY: Resolve any symlinks in the path
    resolvedPath = fs.realpathSync(fullPath);
  } catch {
    return { valid: false, error: 'Cannot resolve path' };
  }

  // SECURITY: Final containment check - resolved path must be within vault
  // This catches symlink attacks that point outside the vault
  if (!resolvedPath.startsWith(config.resolvedVaultPath + path.sep)) {
    logSecurityEvent('path_traversal_blocked', {
      reason: 'symlink_escape',
      attemptedPath: sanitizeForLog(trimmed),
      resolvedOutside: true
    });
    return { valid: false, error: 'Path resolves outside vault' };
  }

  // SECURITY: Verify it's a file, not a directory
  const fileStats = fs.statSync(resolvedPath);
  if (!fileStats.isFile()) {
    return { valid: false, error: 'Path is not a file' };
  }

  return { valid: true, resolvedPath };
}

/**
 * Validate a search query string.
 */
export function validateQuery(query: string, maxLength: number): ValidationResult {
  if (!query || typeof query !== 'string') {
    return { valid: false, error: 'Query is required' };
  }

  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'Query cannot be empty' };
  }

  if (trimmed.length > maxLength) {
    return { valid: false, error: `Query exceeds maximum length of ${maxLength}` };
  }

  return { valid: true };
}

/**
 * Validate an embedding vector.
 */
export function validateEmbedding(
  embedding: unknown,
  expectedDimensions: number
): ValidationResult {
  if (!Array.isArray(embedding)) {
    return { valid: false, error: 'Embedding must be an array' };
  }

  if (embedding.length !== expectedDimensions) {
    return {
      valid: false,
      error: `Embedding must have ${expectedDimensions} dimensions, got ${embedding.length}`
    };
  }

  for (let i = 0; i < embedding.length; i++) {
    if (typeof embedding[i] !== 'number' || !isFinite(embedding[i])) {
      return { valid: false, error: `Invalid value at index ${i}` };
    }
  }

  return { valid: true };
}

/**
 * Validate numeric parameters are within bounds.
 */
export function validateLimit(value: unknown, min: number, max: number, name: string): number {
  if (value === undefined || value === null) {
    return min; // Use minimum as default
  }

  const num = Number(value);
  if (!Number.isInteger(num)) {
    throw new Error(`${name} must be an integer`);
  }

  if (num < min || num > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }

  return num;
}

/**
 * Log security-relevant events.
 * These logs help detect attack attempts.
 */
export function logSecurityEvent(event: string, data: Record<string, unknown>): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level: 'WARN',
    event: `security:${event}`,
    data,
  };
  console.error(JSON.stringify(entry));
}

/**
 * Log operational events.
 */
export function log(level: 'INFO' | 'WARN' | 'ERROR', event: string, data?: Record<string, unknown>): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...(data && { data }),
  };
  console.error(JSON.stringify(entry));
}

/**
 * Sanitize a value for logging (prevent log injection, limit length).
 */
function sanitizeForLog(value: string): string {
  // Remove control characters and limit length
  return value
    .replace(/[\x00-\x1F\x7F]/g, '')
    .slice(0, 100);
}
