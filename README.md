# Smart Connections MCP Server

Read-only semantic search for your Obsidian vault. No write access. No surprises.

A minimal, security-hardened [Model Context Protocol](https://modelcontextprotocol.io/) server that exposes [Smart Connections](https://github.com/brianpetro/obsidian-smart-connections) embeddings to Claude Code and other MCP clients.

## Why This Exists

Existing Smart Connections MCP servers have security issues:
- Path traversal vulnerabilities
- Unnecessary write access
- Heavy dependencies (PyTorch for simple queries)

This implementation is **~200 lines of auditable code** with a single dependency.

## Features

- **Semantic search** using pre-computed Smart Connections embeddings
- **Read-only** - no write operations, no shell execution
- **Secure** - strict path validation, documented threat model
- **Minimal** - just the MCP SDK, no ML libraries
- **Offline** - works without Obsidian running

## Security Model

| Property | Guarantee |
|----------|-----------|
| Path confinement | All file access validated against vault root |
| No traversal | `../` and symlink attacks blocked |
| Read-only | No write operations exposed |
| Bounded responses | Capped results, content length, total size |
| Fail closed | Errors deny access, never bypass |

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

Add to your Claude Code MCP config (`~/.claude.json` or project settings):

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

## Usage

Once configured, Claude Code can use these tools:

### Search Similar Notes

Find notes semantically similar to an existing note:

```
"Find notes similar to Topics/Claude_Code.md"
→ Uses search_similar tool
```

### Get Note Content

Retrieve a specific note's content:

```
"Show me the content of Topics/Obsidian.md"
→ Uses get_note tool
```

### List Indexed Notes

See all notes with embeddings:

```
"What notes are indexed in my vault?"
→ Uses list_indexed tool
```

## Tools

| Tool | Description |
|------|-------------|
| `search_similar` | Find notes similar to a given note |
| `search_by_embedding` | Search using a raw embedding vector |
| `get_note` | Get content of a specific note |
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

## License

MIT

## Credits

- [Smart Connections](https://github.com/brianpetro/obsidian-smart-connections) by Brian Petro
- [Model Context Protocol](https://modelcontextprotocol.io/) by Anthropic
