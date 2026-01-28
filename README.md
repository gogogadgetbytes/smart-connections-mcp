# Smart Connections MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](package.json)

A security-first MCP server for Smart Connections. Read-only. Path-validated. Auditable.

Exposes [Smart Connections](https://github.com/brianpetro/obsidian-smart-connections) embeddings to Claude Code and other [MCP](https://modelcontextprotocol.io/) clients for semantic search of your Obsidian vault.

## Why This Exists

We needed semantic search of our Obsidian vault from Claude Code. Existing options have problems:

- **No path validation** - User input passed directly to file operations
- **Write access** - Some expose mutation tools we don't need
- **Heavy dependencies** - PyTorch/transformers for what's essentially vector math

This implementation:
- **Single dependency** - just the MCP SDK
- **Fail-closed security** - documented threat model, path validation with realpath, symlink detection
- **Auditable** - small TypeScript codebase you can actually read

## Features

- **Semantic search** using pre-computed Smart Connections embeddings
- **Read-only** - no write operations, no shell execution
- **Secure** - strict path validation, bounded responses
- **Minimal** - no ML libraries, no PyTorch
- **Offline** - works without Obsidian running

## Security Model

| Property | Guarantee |
|----------|-----------|
| Path confinement | All file access validated against vault root |
| No traversal | `../` and symlink attacks blocked |
| Read-only | No write operations exposed |
| Bounded responses | Capped results (50), content length (10KB) |
| Fail closed | Errors deny access, never bypass |
| Audit logging | Security events logged with context |

See [DESIGN.md](docs/DESIGN.md) for the full threat model.

## Installation

### Prerequisites

- Node.js 18+
- Obsidian with [Smart Connections](https://github.com/brianpetro/obsidian-smart-connections) plugin installed
- Embeddings built (open vault in Obsidian, let Smart Connections index)

### Setup

```bash
git clone https://github.com/gogogadgetbytes/smart-connections-mcp
cd smart-connections-mcp
npm install
npm run build
```

### Configure Claude Code

Add to your Claude Code config:

```bash
claude mcp add smart-connections \
  -e VAULT_PATH="/path/to/your/obsidian/vault" \
  -- node /path/to/smart-connections-mcp/dist/index.js
```

Or manually add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "smart-connections": {
      "command": "node",
      "args": ["/path/to/smart-connections-mcp/dist/index.js"],
      "env": {
        "VAULT_PATH": "/path/to/your/obsidian/vault"
      }
    }
  }
}
```

Restart Claude Code to load the server.

## Usage

Once configured, Claude Code can use these tools:

### Search Similar Notes

```
"Find notes similar to Topics/Claude_Code.md"
→ Uses search_similar tool
```

### Get Note Content

```
"Show me the content of Topics/Obsidian.md"
→ Uses get_note tool
```

### List Indexed Notes

```
"What notes are indexed in my vault?"
→ Uses list_indexed tool
```

## Tools

| Tool | Description |
|------|-------------|
| `search_similar` | Find notes semantically similar to a given note |
| `search_by_embedding` | Search using a raw embedding vector |
| `get_note` | Get content of a specific note (path validated) |
| `get_model_info` | Get embedding model configuration |
| `list_indexed` | List all indexed notes |

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `VAULT_PATH` | Yes | Absolute path to Obsidian vault |

## Limitations

- **Single vault** - Configure one vault per MCP server instance
- **Pre-computed embeddings only** - Doesn't generate new embeddings
- **No write access** - By design; use Obsidian for edits

## Development

```bash
# Build
npm run build

# Test with MCP Inspector
npx @modelcontextprotocol/inspector node dist/index.js
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security-focused PRs welcome.

## Security

To report security vulnerabilities, please email gogogadgetcode@proton.me. Do not open public issues for security concerns.

## License

MIT - see [LICENSE](LICENSE)

## Credits

- [Smart Connections](https://github.com/brianpetro/obsidian-smart-connections) by Brian Petro
- [Model Context Protocol](https://modelcontextprotocol.io/) by Anthropic
