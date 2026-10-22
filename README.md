# @pipeworx/epo-ops

European Patent Office Open Patent Services MCP — published patents from the EPO worldwide patent register (DocDB). Covers Europe and, via INPADOC family data, related filings across many jurisdictions worldwide — **including PCT international applications (publications beginning "WO")**: this is Pipeworx's PCT source (ruled 2026-10-18, no WIPO PCT webservice purchase). For US-only filings use the [`patents`](../patents/README.md) pack (USPTO ODP) instead — it doesn't overlap with this one on claims/citation coverage: this pack has `get_claims`, that one doesn't.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1866+ live data sources. This is an independent, unofficial integration — not affiliated with, endorsed by, or published by the upstream provider.

This pack does **not** carry a PCT application's International Search Report (ISR) or Written Opinion — the EPO's worldwide data service doesn't hold that document at all. For the ISR/Written Opinion itself, go to WIPO PATENTSCOPE instead.

## Tools

- `search_patents(query, range?)` — CQL search against published patents (EP, US, CN, JP, KR, WO/PCT and 100+ other offices)
- `get_biblio(number, format?)` — bibliographic data
- `get_family(number, raw?)` — INPADOC family: a flat list of every related publication worldwide (country, kind, date, application number, priority claims), with a member count and the countries covered given first; `raw:true` also returns the underlying OPS payload
- `get_abstract(number)` — abstract text
- `get_claims(number)` — claims text
- `get_legal_status(number)` — INPADOC legal status: grant, lapse, opposition, withdrawal, appeal and renewal-fee events, grouped per family member/contracting state

Every `number` argument accepts a publication number in any printed form — "WO2025028566", "WO 2025/028566", "WO2025028566A1" all resolve to the same record. `get_family` additionally accepts a WIPO-style PCT application number before it has published, e.g. "PCT/US2024/012345" — this resolves to the receiving office's own application record and reports which form it matched.

## Auth

- **Platform key:** gateway env `PLATFORM_EPO_KEY` (consumer_key:consumer_secret pair joined with colon)
- **BYO:** `?_apiKey=<consumer_key>:<consumer_secret>` after registering at https://developers.epo.org/

The pack exchanges credentials for a bearer token (20-min TTL, cached).

## Data source

Publisher: the **European Patent Office (EPO)**. Dataset: **Open Patent Services (OPS)** — the EPO's worldwide bibliographic, full-text and legal-status data service, built on DOCDB (100+ patent offices, including WIPO/PCT) and INPADOC family and legal-event data. OAuth2 client-credentials auth; responses are rendered as JSON.

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

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/epo-ops/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1866+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/epo_ops_search_patents \
  -H 'Content-Type: application/json' \
  -d '{"query":"ta=hydrogen fuel cell"}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/epo_ops_search_patents`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.

## Standalone (no gateway account)

This package also runs as a local stdio MCP server — no Pipeworx account, no
gateway round-trip:

```json
{
  "mcpServers": {
    "epo-ops": {
      "command": "npx",
      "args": ["-y", "@pipeworx/mcp-epo-ops"]
    }
  }
}
```

Or run it directly to confirm it starts:

```bash
npx -y @pipeworx/mcp-epo-ops
```

It speaks MCP over stdin/stdout and answers `initialize`/`tools/list`/`tools/call`
for **only** this pack's tools — none of the shared meta-tools the gateway
connection above adds. Same source, same tools, no ask_pipeworx routing.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Epo Ops data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
