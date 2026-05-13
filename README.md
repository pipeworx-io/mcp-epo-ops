# mcp-epo-ops

EPO Open Patent Services MCP

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 250+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `get_biblio` | Bibliographic data for a patent — title, inventors, applicants, dates, classifications. |
| `get_family` | INPADOC family — related patent applications worldwide for the same underlying invention. |
| `get_abstract` | Abstract text for a patent. |
| `get_claims` | Claims text for a patent. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "epo-ops": {
      "url": "https://gateway.pipeworx.io/epo-ops/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 250+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Epo Ops data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [All tools and guides](https://github.com/pipeworx-io/examples)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
