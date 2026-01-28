/**
 * MCP Tool definitions and handlers.
 *
 * Exposes 5 read-only tools for semantic search:
 * - search_similar: Find notes similar to an existing note
 * - search_by_embedding: Search using a raw embedding vector
 * - get_note: Get content of a specific note
 * - get_model_info: Get embedding model configuration
 * - list_indexed: List all indexed notes
 */

import * as fs from 'node:fs';
import { z } from 'zod';
import {
  Config,
  validateNotePath,
  validateEmbedding,
  validateLimit,
  log,
} from './security.js';
import { SmartConnectionsData, extractTitle } from './data.js';
import { findSimilar, findSimilarToNote } from './search.js';

// ============================================================================
// Tool Schemas (Zod)
// ============================================================================

export const SearchSimilarSchema = z.object({
  notePath: z.string().describe('Path to note relative to vault root (e.g., "Topics/Claude_Code.md")'),
  limit: z.number().min(1).max(50).default(10).describe('Maximum results to return (1-50)'),
  threshold: z.number().min(0).max(1).default(0.3).describe('Minimum similarity score (0-1)'),
});

export const SearchByEmbeddingSchema = z.object({
  embedding: z.array(z.number()).describe('Embedding vector (must match model dimensions)'),
  limit: z.number().min(1).max(50).default(10).describe('Maximum results to return (1-50)'),
  threshold: z.number().min(0).max(1).default(0.3).describe('Minimum similarity score (0-1)'),
});

export const GetNoteSchema = z.object({
  notePath: z.string().describe('Path to note relative to vault root'),
});

export const ListIndexedSchema = z.object({
  pattern: z.string().optional().describe('Filter by path prefix (e.g., "Topics/")'),
});

// ============================================================================
// Tool Definitions (for MCP registration)
// ============================================================================

export const toolDefinitions = [
  {
    name: 'search_similar',
    description: 'Find notes semantically similar to an existing note in your vault',
    inputSchema: {
      type: 'object' as const,
      properties: {
        notePath: {
          type: 'string',
          description: 'Path to note relative to vault root (e.g., "Topics/Claude_Code.md")',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (1-50, default: 10)',
          default: 10,
        },
        threshold: {
          type: 'number',
          description: 'Minimum similarity score (0-1, default: 0.3)',
          default: 0.3,
        },
      },
      required: ['notePath'],
    },
  },
  {
    name: 'search_by_embedding',
    description: 'Find notes similar to a provided embedding vector',
    inputSchema: {
      type: 'object' as const,
      properties: {
        embedding: {
          type: 'array',
          items: { type: 'number' },
          description: 'Embedding vector (must match model dimensions)',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (1-50, default: 10)',
          default: 10,
        },
        threshold: {
          type: 'number',
          description: 'Minimum similarity score (0-1, default: 0.3)',
          default: 0.3,
        },
      },
      required: ['embedding'],
    },
  },
  {
    name: 'get_note',
    description: 'Retrieve the content of a specific note from the vault',
    inputSchema: {
      type: 'object' as const,
      properties: {
        notePath: {
          type: 'string',
          description: 'Path to note relative to vault root',
        },
      },
      required: ['notePath'],
    },
  },
  {
    name: 'get_model_info',
    description: 'Get information about the embedding model used by this vault',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'list_indexed',
    description: 'List all notes that have been indexed with embeddings',
    inputSchema: {
      type: 'object' as const,
      properties: {
        pattern: {
          type: 'string',
          description: 'Optional path prefix filter (e.g., "Topics/")',
        },
      },
      required: [],
    },
  },
];

// ============================================================================
// Tool Handlers
// ============================================================================

export interface ToolContext {
  config: Config;
  data: SmartConnectionsData;
}

export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

/**
 * Handle search_similar tool call.
 */
export function handleSearchSimilar(
  args: unknown,
  ctx: ToolContext
): ToolResult {
  const parsed = SearchSimilarSchema.safeParse(args);
  if (!parsed.success) {
    return errorResult(`Invalid arguments: ${parsed.error.message}`);
  }

  const { notePath, limit, threshold } = parsed.data;

  // Validate the note path exists in index (no filesystem access needed for search)
  const normalizedPath = notePath.replace(/^\/+/, '');
  if (!ctx.data.entries.has(normalizedPath)) {
    return errorResult(`Note not found in index: ${notePath}`);
  }

  const results = findSimilarToNote(normalizedPath, ctx.data.entries, {
    limit: validateLimit(limit, 1, ctx.config.limits.maxResults, 'limit'),
    threshold,
  });

  if (!results) {
    return errorResult(`Note not found in index: ${notePath}`);
  }

  log('INFO', 'search_similar', { notePath, resultCount: results.length });

  return successResult({
    query: notePath,
    results,
  });
}

/**
 * Handle search_by_embedding tool call.
 */
export function handleSearchByEmbedding(
  args: unknown,
  ctx: ToolContext
): ToolResult {
  const parsed = SearchByEmbeddingSchema.safeParse(args);
  if (!parsed.success) {
    return errorResult(`Invalid arguments: ${parsed.error.message}`);
  }

  const { embedding, limit, threshold } = parsed.data;

  // Validate embedding dimensions
  const validation = validateEmbedding(embedding, ctx.data.modelInfo.dimensions);
  if (!validation.valid) {
    return errorResult(validation.error!);
  }

  const results = findSimilar(embedding, ctx.data.entries, {
    limit: validateLimit(limit, 1, ctx.config.limits.maxResults, 'limit'),
    threshold,
  });

  log('INFO', 'search_by_embedding', { resultCount: results.length });

  return successResult({
    results,
  });
}

/**
 * Handle get_note tool call.
 *
 * SECURITY: This is a sensitive operation - validates path carefully.
 */
export function handleGetNote(
  args: unknown,
  ctx: ToolContext
): ToolResult {
  const parsed = GetNoteSchema.safeParse(args);
  if (!parsed.success) {
    return errorResult(`Invalid arguments: ${parsed.error.message}`);
  }

  const { notePath } = parsed.data;

  // SECURITY: Validate path before any filesystem access
  const validation = validateNotePath(ctx.config, notePath);
  if (!validation.valid) {
    return errorResult(validation.error!);
  }

  // Read file content
  let content: string;
  try {
    content = fs.readFileSync(validation.resolvedPath!, 'utf-8');
  } catch {
    // SECURITY: Don't expose filesystem error details
    return errorResult('Failed to read note');
  }

  // SECURITY: Enforce content length limit
  if (content.length > ctx.config.limits.maxContentLength) {
    content = content.slice(0, ctx.config.limits.maxContentLength);
    content += '\n\n[Content truncated - exceeded maximum length]';
  }

  log('INFO', 'get_note', { notePath, contentLength: content.length });

  return successResult({
    path: notePath,
    title: extractTitle(notePath),
    content,
  });
}

/**
 * Handle get_model_info tool call.
 */
export function handleGetModelInfo(
  _args: unknown,
  ctx: ToolContext
): ToolResult {
  return successResult({
    modelKey: ctx.data.modelInfo.modelKey,
    dimensions: ctx.data.modelInfo.dimensions,
    adapter: ctx.data.modelInfo.adapter,
  });
}

/**
 * Handle list_indexed tool call.
 */
export function handleListIndexed(
  args: unknown,
  ctx: ToolContext
): ToolResult {
  const parsed = ListIndexedSchema.safeParse(args);
  if (!parsed.success) {
    return errorResult(`Invalid arguments: ${parsed.error.message}`);
  }

  const { pattern } = parsed.data;

  const notes: Array<{ path: string; title: string }> = [];

  for (const [notePath] of ctx.data.entries) {
    // Apply pattern filter if provided
    if (pattern && !notePath.startsWith(pattern)) {
      continue;
    }

    notes.push({
      path: notePath,
      title: extractTitle(notePath),
    });
  }

  // Sort alphabetically by path
  notes.sort((a, b) => a.path.localeCompare(b.path));

  return successResult({
    count: notes.length,
    notes,
  });
}

// ============================================================================
// Helper Functions
// ============================================================================

function successResult(data: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

/**
 * Route a tool call to the appropriate handler.
 */
export function handleToolCall(
  name: string,
  args: unknown,
  ctx: ToolContext
): ToolResult {
  switch (name) {
    case 'search_similar':
      return handleSearchSimilar(args, ctx);
    case 'search_by_embedding':
      return handleSearchByEmbedding(args, ctx);
    case 'get_note':
      return handleGetNote(args, ctx);
    case 'get_model_info':
      return handleGetModelInfo(args, ctx);
    case 'list_indexed':
      return handleListIndexed(args, ctx);
    default:
      return errorResult(`Unknown tool: ${name}`);
  }
}
