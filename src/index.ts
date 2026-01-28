#!/usr/bin/env node
/**
 * Smart Connections MCP Server
 *
 * A minimal, security-hardened MCP server for semantic search
 * of Obsidian vaults using Smart Connections embeddings.
 *
 * Security principles:
 * - Read-only: No write operations
 * - Path confined: All access validated against vault root
 * - Fail closed: Errors deny access
 * - Minimal: Single dependency (MCP SDK)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { validateConfig, log, Config } from './security.js';
import { loadSmartConnectionsData, SmartConnectionsData } from './data.js';
import { toolDefinitions, handleToolCall, ToolContext } from './tools.js';

const VERSION = '0.1.0';

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  // Parse command line arguments
  const vaultPath = getVaultPath();

  // SECURITY: Validate configuration at startup (fail fast)
  let config: Config;
  try {
    config = validateConfig(vaultPath);
    log('INFO', 'config_validated', { vaultPath: config.vaultPath });
  } catch (e) {
    log('ERROR', 'config_validation_failed', { error: String(e) });
    process.exit(1);
  }

  // Load Smart Connections data
  let data: SmartConnectionsData;
  try {
    data = loadSmartConnectionsData(config);
  } catch (e) {
    log('ERROR', 'data_load_failed', { error: String(e) });
    process.exit(1);
  }

  // Create tool context
  const ctx: ToolContext = { config, data };

  // Create MCP server
  const server = new Server(
    {
      name: 'smart-connections-mcp',
      version: VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tool listing handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: toolDefinitions,
    };
  });

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const result = handleToolCall(name, args, ctx);

    return result;
  });

  // Start server with stdio transport
  const transport = new StdioServerTransport();

  log('INFO', 'server_starting', {
    version: VERSION,
    vaultPath: config.vaultPath,
    indexedNotes: data.entries.size,
    modelKey: data.modelInfo.modelKey,
  });

  await server.connect(transport);

  log('INFO', 'server_connected');

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    log('INFO', 'server_shutdown', { reason: 'SIGINT' });
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    log('INFO', 'server_shutdown', { reason: 'SIGTERM' });
    process.exit(0);
  });
}

/**
 * Get vault path from CLI args or environment variable.
 */
function getVaultPath(): string | undefined {
  // Check CLI args: --vault /path/to/vault
  const args = process.argv.slice(2);
  const vaultIdx = args.indexOf('--vault');
  if (vaultIdx !== -1 && args[vaultIdx + 1]) {
    return args[vaultIdx + 1];
  }

  // Fall back to environment variable
  return process.env.VAULT_PATH;
}

// Run the server
main().catch((e) => {
  log('ERROR', 'server_fatal', { error: String(e) });
  process.exit(1);
});
