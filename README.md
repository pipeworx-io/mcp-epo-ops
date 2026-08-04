# @pipeworx/epo-ops

European Patent Office Open Patent Services MCP — published patents from the EPO worldwide patent register (DocDB).

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

- `search_patents(query, range?)` — CQL search against published patents
- `get_biblio(number, format?)` — bibliographic data
- `get_family(number)` — INPADOC family (related applications worldwide)
- `get_abstract(number)` — abstract text
- `get_claims(number)` — claims text

## Auth

- **Platform key:** gateway env `PLATFORM_EPO_KEY` (consumer_key:consumer_secret pair joined with colon)
- **BYO:** `?_apiKey=<consumer_key>:<consumer_secret>` after registering at https://developers.epo.org/

The pack exchanges credentials for a bearer token (20-min TTL, cached).

## Data source

`https://ops.epo.org/3.2/rest-services/` — OAuth2 client_credentials, JSON via `Accept: application/json`.

Patent number formats: EPO docdb (`EP.1234567.A1`), epodoc (`EP1234567`), original (`EP1234567B1`).

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

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

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

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
