# Contributing

Thanks for your interest in improving smart-connections-mcp.

## Security First

This is a security-focused project. Before submitting changes:

1. **Read [DESIGN.md](docs/DESIGN.md)** - Understand the threat model and security invariants
2. **No new dependencies** without discussion - Each dependency is attack surface
3. **Path operations** must go through `validateNotePath()` in security.ts
4. **Fail closed** - If you're unsure whether to allow or deny, deny

## Pull Requests

- Keep changes focused and small
- Explain the "why" not just the "what"
- If adding tools: they must be read-only
- Security-relevant changes require extra review

## Code Style

- TypeScript strict mode
- Explicit types (no `any`)
- Comments for security-relevant decisions
- Follow existing patterns

## Testing

Before submitting:

```bash
npm run build
# Test manually with your vault
VAULT_PATH=/path/to/vault node dist/index.js
```

## Reporting Security Issues

**Do not open public issues for security vulnerabilities.**

Email security@gogogadgetbytes with:
- Description of the vulnerability
- Steps to reproduce
- Potential impact

We'll respond within 48 hours and work with you on a fix.

## Questions?

Open an issue for general questions or feature discussions.
