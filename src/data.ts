/**
 * Data loading module for Smart Connections embeddings.
 *
 * Reads pre-computed embeddings from Smart Connections plugin's
 * .smart-env directory. Does NOT compute new embeddings.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Config, log } from './security.js';

export interface EmbeddingEntry {
  path: string;
  embedding: number[];
  blocks?: Record<string, BlockInfo>;
}

export interface BlockInfo {
  hash?: string;
  size?: number;
  lines?: [number, number];
}

export interface ModelInfo {
  modelKey: string;
  dimensions: number;
  adapter: string;
}

export interface SmartConnectionsData {
  entries: Map<string, EmbeddingEntry>;
  modelInfo: ModelInfo;
}

/**
 * Load Smart Connections data from the vault's .smart-env directory.
 */
export function loadSmartConnectionsData(config: Config): SmartConnectionsData {
  const smartEnvPath = path.join(config.resolvedVaultPath, '.smart-env');

  // Load model info from smart_env.json
  const modelInfo = loadModelInfo(smartEnvPath);
  log('INFO', 'model_loaded', { modelKey: modelInfo.modelKey, dimensions: modelInfo.dimensions });

  // Load embeddings from multi/*.ajson files
  const entries = loadEmbeddings(smartEnvPath, modelInfo.modelKey);
  log('INFO', 'embeddings_loaded', { count: entries.size });

  return { entries, modelInfo };
}

/**
 * Load model configuration from smart_env.json
 */
function loadModelInfo(smartEnvPath: string): ModelInfo {
  const configPath = path.join(smartEnvPath, 'smart_env.json');

  if (!fs.existsSync(configPath)) {
    throw new Error(`Smart env config not found: ${configPath}`);
  }

  let config: unknown;
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    config = JSON.parse(content);
  } catch (e) {
    throw new Error(`Failed to parse smart_env.json: ${e}`);
  }

  // Navigate to model key - handle nested structure
  const modelKey = extractModelKey(config);
  if (!modelKey) {
    throw new Error('Could not determine embedding model from smart_env.json');
  }

  // Determine dimensions based on known models
  const dimensions = getModelDimensions(modelKey);

  return {
    modelKey,
    dimensions,
    adapter: 'transformers',
  };
}

/**
 * Extract model key from smart_env.json config structure.
 */
function extractModelKey(config: unknown): string | null {
  if (!config || typeof config !== 'object') return null;

  const c = config as Record<string, unknown>;

  // Try smart_sources.embed_model.transformers.model_key
  const smartSources = c.smart_sources as Record<string, unknown> | undefined;
  if (smartSources?.embed_model) {
    const embedModel = smartSources.embed_model as Record<string, unknown>;
    if (embedModel.transformers) {
      const transformers = embedModel.transformers as Record<string, unknown>;
      if (typeof transformers.model_key === 'string') {
        return transformers.model_key;
      }
    }
  }

  return null;
}

/**
 * Get embedding dimensions for known models.
 */
function getModelDimensions(modelKey: string): number {
  const knownModels: Record<string, number> = {
    'TaylorAI/bge-micro-v2': 384,
    'sentence-transformers/all-MiniLM-L6-v2': 384,
    'BAAI/bge-small-en-v1.5': 384,
    'BAAI/bge-base-en-v1.5': 768,
    'BAAI/bge-large-en-v1.5': 1024,
  };

  const dimensions = knownModels[modelKey];
  if (dimensions) {
    return dimensions;
  }

  // Default to 384 (most common for small models)
  log('WARN', 'unknown_model_dimensions', { modelKey, defaulting: 384 });
  return 384;
}

/**
 * Load embeddings from .ajson files in the multi/ directory.
 */
function loadEmbeddings(smartEnvPath: string, modelKey: string): Map<string, EmbeddingEntry> {
  const multiPath = path.join(smartEnvPath, 'multi');
  const entries = new Map<string, EmbeddingEntry>();

  if (!fs.existsSync(multiPath)) {
    log('WARN', 'no_multi_directory', { path: multiPath });
    return entries;
  }

  const files = fs.readdirSync(multiPath).filter(f => f.endsWith('.ajson'));

  for (const file of files) {
    const filePath = path.join(multiPath, file);
    try {
      const fileEntries = parseAjsonFile(filePath, modelKey);
      for (const [key, entry] of fileEntries) {
        entries.set(key, entry);
      }
    } catch (e) {
      log('WARN', 'ajson_parse_error', { file, error: String(e) });
      // Continue with other files
    }
  }

  return entries;
}

/**
 * Parse a single .ajson file.
 *
 * Smart Connections uses an "append JSON" format where each file contains
 * entries like: "key": {value}, one per line. We wrap in braces and parse
 * as a single JSON object.
 */
function parseAjsonFile(filePath: string, modelKey: string): Map<string, EmbeddingEntry> {
  const entries = new Map<string, EmbeddingEntry>();
  const content = fs.readFileSync(filePath, 'utf-8').trim();

  if (!content) return entries;

  // The file content is a series of "key": {...}, entries
  // Wrap in braces to make it valid JSON, removing trailing comma
  let jsonContent = content;

  // Remove trailing comma if present (before we wrap)
  if (jsonContent.endsWith(',')) {
    jsonContent = jsonContent.slice(0, -1);
  }

  // Wrap in braces to create valid JSON object
  const wrappedContent = '{' + jsonContent + '}';

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(wrappedContent);
  } catch (e) {
    // If parsing fails, log and return empty
    log('WARN', 'ajson_json_parse_failed', {
      file: path.basename(filePath),
      error: String(e).slice(0, 100)
    });
    return entries;
  }

  // Iterate over all entries in the parsed object
  for (const [fullKey, value] of Object.entries(parsed)) {
    // Only process smart_sources entries (file-level), skip smart_blocks
    if (!fullKey.startsWith('smart_sources:')) continue;

    const notePath = fullKey.replace(/^smart_sources:/, '');

    // Skip if it's actually a block (has # in path)
    if (notePath.includes('#')) continue;

    const data = value as Record<string, unknown>;

    // Extract embedding vector
    const embeddings = data.embeddings as Record<string, { vec?: number[] }> | undefined;
    if (!embeddings) continue;

    const modelData = embeddings[modelKey];
    if (!modelData?.vec || !Array.isArray(modelData.vec)) continue;

    // Extract block info if present
    const blocks = data.blocks as Record<string, BlockInfo> | undefined;

    entries.set(notePath, {
      path: notePath,
      embedding: modelData.vec,
      blocks,
    });
  }

  return entries;
}

/**
 * Get the note path relative to vault root, suitable for display.
 */
export function normalizeNotePath(notePath: string): string {
  // Remove leading slashes if present
  return notePath.replace(/^\/+/, '');
}

/**
 * Extract a title from a note path (filename without extension).
 */
export function extractTitle(notePath: string): string {
  const filename = path.basename(notePath, '.md');
  // Replace underscores with spaces for readability
  return filename.replace(/_/g, ' ');
}
