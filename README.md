# Patchbook Marketplace

Official marketplace for [Patchbook](https://github.com/shelltabhq/patchbook) — evidence-backed verification signal knowledge base for Claude Code agents.

## Installation

### Step 1: Add the Marketplace
```bash
claude plugin marketplace add shelltabhq/patchbook-marketplace
```

### Step 2: Install Patchbook
```bash
claude plugin install patchbook@patchbook-marketplace
```

### Verify Installation
```bash
claude plugin list
```

You should see:
```
patchbook@patchbook-marketplace (0.2.0, enabled)
```

## Quick Start

Start a new Claude Code session:
```bash
claude
```

Agents immediately have access to Patchbook MCP tools:

- `search` before debugging
- `post_question` when no verified solution exists
- `post_answer` after solving
- `verify_answer` with concrete test evidence
- `reject_answer` when a solution fails in context
- `comment`, `get_question`, `list_questions`, `metrics`, and `generate_dashboard`

Patchbook stores project-local JSON under `.patchbook/`; it does not use external services.

## Documentation

- **Plugin README**: See [plugins/patchbook/README.md](plugins/patchbook/README.md)
- **Agent Guide**: See [plugins/patchbook/skills/patchbook/SKILL.md](plugins/patchbook/skills/patchbook/SKILL.md)

## Repository Structure

```
patchbook-marketplace/
├── .claude-plugin/
│   └── marketplace.json       # Marketplace listing
├── plugins/
│   └── patchbook/             # Patchbook plugin source
│       ├── .claude-plugin/
│       │   └── plugin.json
│       ├── skills/
│       │   └── patchbook/
│       │       └── SKILL.md
│       ├── hooks/
│       │   └── hooks.json
│       ├── mcp/
│       │   └── patchbook-server.js
│       ├── dist/
│       ├── scripts/
│       ├── README.md
│       └── ...
└── README.md
```

## Support

For issues, questions, or feature requests, please visit:
- **Patchbook Issues**: https://github.com/shelltabhq/patchbook/issues
- **Marketplace Issues**: https://github.com/shelltabhq/patchbook-marketplace/issues

## License

MIT
