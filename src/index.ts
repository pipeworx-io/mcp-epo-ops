interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Was this failure OUR OWN web service? — the other half of `internal-db-class.ts`.
 *
 * fleet #1089 pulled failures from our own Postgres out of `upstream_down` by
 * keying on the SQLSTATE inside PostgREST's four-key error envelope. That
 * covered the majority and structurally could not cover the rest: the rest
 * never reach Postgres, so they carry no SQLSTATE. What was left, measured over
 * the 24h to 2026-09-02T15:00Z (fleet #1096):
 *
 *     5  pipeworx-catalog  get_pack_tools     Pipeworx catalog error: 522 — error code: 522
 *     3  fleet             fleet_list_open …  upstream_down: Fleet task queue did not respond within 25s
 *
 * 521/522/523/526 are Cloudflare saying its edge could not reach an ORIGIN, and
 * in both of those rows the origin is ours — `gateway.pipeworx.io` for the
 * catalog pack (it self-fetches when the gateway hasn't injected a manifest),
 * our own Supabase for fleet. There is no third party anywhere in either call.
 * Same defect as #1089: our own outage filed under `upstream_down`, the one
 * class that means "the source is unreachable and there is nothing for us to
 * fix", which is why the problem-tools triage skips it.
 *
 * WHY NOT A WORDING RULE. The obvious fix is to match `fleet db error:` and
 * `Pipeworx catalog error:` in classifyToolError. Each is emitted from exactly
 * one site today, so it would work today. It would also rot the first time
 * somebody rewords a label — silently, and in the direction of hiding our own
 * outage, which is worse than the bug being fixed. Every prose rule in
 * error-class.ts has needed widening as packs invented new wording (#409/#450/
 * #584); that history is most of that file's comment budget.
 *
 * WHAT THIS KEYS ON INSTEAD: **the host the call actually reached.** A URL's
 * hostname is a fact about the call, not a guess about its prose. Two
 * consequences that a pack-level flag could not give us, and the reason the
 * flag was rejected:
 *
 *   - It describes the CALL, not the pack. `govcon-intel` fans out to our own
 *     Supabase AND to genuine third parties; `court-listener` holds our cache
 *     in Supabase and fetches courtlistener.com. An `internallyHosted: true` on
 *     either pack would relabel a real third-party outage as ours — inventing
 *     work, which is the same class of error in the opposite direction.
 *   - It covers every future internal pack for free, instead of one declared
 *     slug at a time.
 *
 * WHY IT SURVIVES A REWORD. The marker below is not matched as a literal by two
 * separate files. `markInternalOrigin()` writes it and `internalHostMetricsClass()`
 * reads it, both from the single exported `INTERNAL_ORIGIN_MARKER` constant in
 * this module — so changing the wording changes both sides in the same edit and
 * cannot desynchronise them. The pack's own label (`fleet db error:`,
 * `Pipeworx catalog error:`) is not read at all: reword it freely, the class is
 * unaffected. That is the property `stripClassPrefix` lacked when it drifted
 * from its own classifier three times and needed a CI gate to hold them
 * together.
 *
 * WHERE THE 5xx TEST LIVES. `markInternalOrigin` is called from the places that
 * hold the real `Response` — `httpError`/`httpErrorMessage` and the timeout
 * branch of `fetchWithTimeout` in `shared/src/http.ts` — so "is this an
 * availability failure" is decided from the actual status code, never re-derived
 * by scraping a number out of a sentence. A 404 from our own registry for a slug
 * that does not exist is a caller's bad argument and is deliberately NOT marked.
 */

/**
 * OUR OWN web service was unreachable — not an upstream, and never `upstream_down`.
 *
 * ONE value, not three, unlike `internal_db_*`. That split existed because a
 * slow query, an exhausted pool and an unknown SQLSTATE have different owners
 * and different fixes. Here there is only one story to tell — an origin we run
 * did not answer the edge — and one owner. A bucket with no distinct owner per
 * value is decoration; #724 is what happens when a class holds several
 * situations, and inventing sub-values ahead of a reason to act on them
 * differently is the same mistake with the sign flipped.
 *
 * METRICS ONLY, exactly like PLATFORM_KEY_ERROR_CLASS and the internal_db
 * values. `classifyToolError` still answers `upstream_down` for the retry and
 * hint paths, which only care whether retrying or a sibling tool might work —
 * and it might. Nothing a caller sees or is charged changes here.
 *
 * READ SIDE: this value is in BROKEN_TOOL_CLASSES, FAULT_CLASSES and
 * ALL_ERROR_CLASSES in `workers/registry-api/src/index.ts`. All three, or it
 * lands on no dashboard — fleet #721 is the warning, where the #719 split
 * worked on the write side and was invisible for weeks.
 */
const INTERNAL_SERVICE_UNREACHABLE_CLASS = 'internal_service_unreachable';

/**
 * The token that carries "this origin is ours" from the call site to the
 * classifier.
 *
 * Appended to the error message rather than attached to the Error object,
 * because the object does not survive the trip: 275 packs return `{ error:
 * string }` instead of throwing, the gateway reads `observedError` as a string,
 * and the fleet pack rebuilds its error from a captured status + body across a
 * retry loop. A property on an Error would be dropped by every one of those
 * paths and the class would work in tests and vanish in production.
 *
 * WORDING IS LOAD-BEARING, same rule as labelAge's note in authority.ts. This
 * string is appended to a pack's thrown Error message (shared/src/http.ts),
 * and a thrown Error's message is exactly what the gateway hands back to the
 * caller as `content[0].text` when nothing rewrites it (workers/gateway/src
 * catches the throw and sets `rawResult.message = stripClassPrefix(error)`,
 * which does not touch this suffix) — so the original wording,
 * " [pipeworx-hosted origin — our own service, not a third party]", was not a
 * theoretical leak: it shipped live on pipeworx-catalog's 522s, 7 times in 6
 * hours on 2026-09-02 (see tests/golden-internal-service.test.ts), verbatim
 * naming Pipeworx as the host. check:hosting-claims never caught it because it
 * did not scan shared/ at all (task #2009). Reworded to describe the
 * OBSERVATION (the origin did not answer) without a claim about who runs it —
 * the identical fix labelAge got: drop the possessive, keep the fact.
 */
const INTERNAL_ORIGIN_MARKER = ' [origin did not respond — retry before concluding the named source is down]';

/**
 * Supabase's data plane for a project is `<ref>.supabase.co`, where the ref is
 * exactly twenty lowercase letters (ours is `pqauisounztsgdgfkhke`).
 *
 * Matching the shape rather than listing the ref keeps this correct when we add
 * a project — `supabaseEnv` on a pack entry already points some packs at a
 * second one — while still excluding `status.supabase.co`, which is Supabase's
 * own status page and emphatically not our database. Verified 2026-09-02 by
 * `grep -rhoE '[a-z0-9-]+\.supabase\.(co|in)' mcps shared workers scripts`: the
 * only real project ref anywhere in the tree is ours, the rest are doc
 * placeholders (`abc`, `xyz`, `example`) which this pattern also excludes. Same
 * finding internal-db-class.ts relies on for the PostgREST envelope being ours
 * by construction.
 */
const SUPABASE_PROJECT_HOST = /^[a-z]{20}\.supabase\.(co|in)$/;

/**
 * Is this a host WE run?
 *
 * Deliberately NOT including `*.workers.dev`: plenty of third-party APIs are
 * hosted on workers.dev, so the suffix says where something runs and not who
 * owns it. Every internal call we actually make goes to a `pipeworx.io`
 * hostname or to our Supabase project, both of which are ownership facts.
 *
 * `workers/gateway/src/provenance.ts`'s `OUR_HOSTS` answers the same
 * question and DOES include `workers.dev` — a documented divergence
 * (task #2051), not a bug to converge. That list decides what a response may
 * cite as a data SOURCE, where a false negative (citing our own worker as an
 * external source) is the hosting-disclosure leak this whole file exists to
 * prevent, so it errs broad. This one decides who gets BLAMED for a 5xx in
 * outage metrics read by on-call, where a false positive (crediting our own
 * infra with a third party's outage) hides the real failure, so it errs
 * narrow. Same suffix, opposite direction, because they are never called for
 * the same reason.
 *
 * Returns false on anything unparseable rather than throwing — this runs inside
 * an error path, and an error path that can itself throw turns a diagnosable
 * failure into a mystery.
 */
function isPipeworxOrigin(url: string | URL | undefined | null): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url instanceof URL ? url.href : url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'pipeworx.io' || host.endsWith('.pipeworx.io')) return true;
  return SUPABASE_PROJECT_HOST.test(host);
}

/**
 * Append the marker when this failure was OUR origin failing to answer.
 *
 * `status` is the HTTP status when there is one, and omitted for a timeout —
 * where there is no response at all, and "the origin did not answer" is the
 * whole observation. Statuses below 500 are left alone: a 404 from our own
 * registry for a slug that does not exist is the caller's argument, not our
 * outage, and marking it would put ordinary 404s on the incident dashboard.
 *
 * Idempotent, so a message that is wrapped and re-marked on the way up (the
 * fleet pack's retry loop re-throws through two layers) carries the marker once.
 */
function markInternalOrigin(
  message: string,
  url: string | URL | undefined | null,
  status?: number,
): string {
  if (status !== undefined && status < 500) return message;
  if (!isPipeworxOrigin(url)) return message;
  if (message.includes(INTERNAL_ORIGIN_MARKER)) return message;
  return message + INTERNAL_ORIGIN_MARKER;
}

/**
 * Which blob4 value a failure from our own web services books as, or undefined
 * if this is not one.
 *
 * Ordered AFTER `internalDbMetricsClass` at the call site: a PostgREST envelope
 * from our own Supabase is a strictly more specific statement about the same
 * row (which of our services, and why), and the two cannot disagree about
 * whether the failure is ours.
 */
function internalHostMetricsClass(error: string): string | undefined {
  return error.includes(INTERNAL_ORIGIN_MARKER) ? INTERNAL_SERVICE_UNREACHABLE_CLASS : undefined;
}


/**
 * One place to turn a failed `fetch` into an error a caller can act on.
 *
 * Nearly every pack was written the same way:
 *
 *     if (!res.ok) throw new Error(`Unsplash: ${res.status}`);
 *
 * which discards the response body — and the body is usually where the upstream
 * says what was actually wrong ("**symbol** not found: GBP", "parameter `year`
 * out of range", "unknown taxonomy id"). The caller gets a number, cannot
 * self-correct, and retries the same broken call. A 2026-07-31 sweep found this
 * shape in 481 of 1,400 packs, 47 of them PLATFORM-keyed.
 *
 * It also hides bugs one level down. Two of the first three packs audited had a
 * second defect that only existed because of this line: unsplash's rate-limit
 * branch sat BELOW a catch-all and was unreachable, and bea-gov parsed
 * `BEAAPI.Error.APIErrorDescription` below a `!res.ok` throw that made the
 * parsing dead code for every non-200.
 *
 * DELIBERATELY NOT A CLASSIFIER. It does not add `user_error:` /
 * `upstream_down:` prefixes. Those decide which tier a failure lands in, and the
 * `error` tier is what the daily problem-tools list is built from — it means
 * "Pipeworx has a defect". A 400 is genuinely ambiguous: often a caller's bad
 * argument, but sometimes a query WE built wrong (ted-eu comma-joined its CPV
 * values into something TED rejected, and that bug was found only because it sat
 * in `error`). Blanket-classifying 400s as caller mistakes would have hidden it.
 * A pack that KNOWS which it is should keep saying so explicitly; this helper is
 * for the 481 that say nothing at all.
 */

/** Longest upstream explanation we'll pass through. Enough for a real message,
 *  short enough that an HTML page or a stack trace can't swamp the error. */

const MAX_DETAIL = 300;

/**
 * Default bound for `fetchWithTimeout` when a pack doesn't state its own.
 *
 * 25s mirrors the number `epo-ops` landed on after measuring the real failure:
 * a degraded upstream that doesn't error, it just never answers, and a Worker
 * sits in `await fetch()` until ITS OWN execution budget kills the request —
 * which can take minutes, not seconds (epo_ops_search_patents measured 4-8
 * MINUTE hangs before this existed). 25s is short enough that a caller gets a
 * fast, actionable error instead of holding the connection, and long enough
 * that it doesn't false-trip on a merely-slow-but-alive upstream.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;

/**
 * Read the body of a failed response and fold it into a throwable Error.
 *
 * Usage — note the `await`, which is the one thing that makes this a mechanical
 * change rather than a drop-in:
 *
 *     if (!res.ok) throw await httpError(res, 'Unsplash');
 *
 * Safe to call on any non-ok response: a body that is missing, empty, unreadable
 * or HTML degrades to exactly the old `Name: 404` string rather than throwing
 * something new from inside the error path.
 */
async function httpError(res: Response, name: string): Promise<Error> {
  return new Error(await httpErrorMessage(res, name));
}

/** The message text without constructing an Error — for packs that need to wrap
 *  it in their own envelope or add an explicit classification prefix. */
async function httpErrorMessage(res: Response, name: string): Promise<string> {
  // The one place a 5xx from a host WE run gets stamped as ours. `res.url` is
  // the URL the fetch actually resolved to (after redirects), so this is a fact
  // about the call rather than a guess from the `name` the pack passed in —
  // reword that label freely, the class does not move. See
  // internal-host-class.ts; no-op for every third-party upstream, which is why
  // this touches 481 packs' error text and changes none of it.
  return markInternalOrigin(
    `${name}: ${res.status}${detailSuffix(await readDetail(res))}`,
    res.url,
    res.status,
  );
}

/**
 * Just the upstream's own explanation — no name, no status.
 *
 * For a pack that has already said both in its own sentence. epo-ops reads
 * `EPO rejected this search as too large (HTTP 413) — ${httpErrorMessage(…)}`,
 * which rendered as `… (HTTP 413) — EPO: 413.` once the XML detail was being
 * dropped: the upstream named twice, the status twice, and the one thing EPO
 * actually said ("Not enough characters before truncation character") nowhere
 * (fleet #712). Returns '' when the body carries nothing readable, so a caller
 * can fall back to its own wording.
 */
async function upstreamDetail(res: Response): Promise<string> {
  return readDetail(res);
}

/**
 * Read a SUCCESSFUL response as JSON, failing loudly when it isn't JSON.
 *
 * `httpError` above only ever runs on `!res.ok`, which leaves the nastier half
 * of the problem unhandled: an upstream that answers **HTTP 200 with an HTML
 * page**. A bot wall, a login redirect, a maintenance interstitial and a CDN
 * error page are all 200s, so `res.ok` is true, and `res.json()` then throws
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 *
 * That string is the problem. It names no upstream, carries no status, and
 * reads like a parser bug in Pipeworx — so it lands in the `error` tier, which
 * means "we have a defect", and the caller is told nothing they can act on.
 * data.govt.nz sat dead behind an Imperva challenge this way and every
 * status-code health check we own reported it green (7889a845). A zero-length
 * body has the same shape: `Unexpected end of JSON input`, seen this week on
 * uk-gazette (83% of external calls) and census.
 *
 * UNLIKE `httpError`, this one DOES classify, and the asymmetry is deliberate.
 * A 400 is genuinely ambiguous — often the caller's bad argument, sometimes a
 * query we built wrong — so blanket-classifying it would hide our own bugs.
 * There is no such ambiguity here: **no argument a caller can pass makes a JSON
 * API return an HTML page.** It is always the upstream, so `upstream_down:` is
 * a statement of fact rather than a guess, and it keeps these out of the
 * problem-tools list where they crowd out real defects.
 *
 *     const data = await parseJson<Feed>(res, 'UK Gazette');
 *
 * Call it only after the `!res.ok` check — on a failed response you want
 * `httpError`, which mines the body for the upstream's own explanation.
 */
async function parseJson<T>(res: Response, name: string): Promise<T> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    throw new Error(
      `upstream_down: ${name} returned a body that could not be read (HTTP ${res.status}). ` +
        'The connection most likely dropped mid-response; retrying is reasonable.',
    );
  }

  const type = res.headers.get('content-type') ?? 'no content-type';

  if (!raw.trim()) {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with an EMPTY body where JSON was expected (${type}). ` +
        'Nothing about the request can cause this — it is an upstream fault, and the same call may well work on retry.',
    );
  }

  // Checked before parsing rather than in the catch, because knowing it is
  // markup is what turns "we failed to parse something" into "they served a
  // web page" — the second is diagnosable, the first is not.
  const head = raw.slice(0, 200).trimStart().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml')) {
    const kind = head.startsWith('<?xml') ? 'an XML document' : 'an HTML page';
    // The summary, not the source. Pasting the first 120 characters of a web
    // page handed the agent `<!DOCTYPE html><html lang="en"…` — the same leak
    // this branch exists to describe (fleet #712).
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with ${kind} instead of JSON (${type}). ` +
        'That is typically a bot wall, a login redirect or a maintenance page — it is returned as a SUCCESS, ' +
        `so status-code health checks read it as fine. No argument change will get past it. ` +
        `The page says: ${summarizeErrorBody(raw) || 'nothing readable'}`,
    );
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with a body that is not valid JSON (${type}). ` +
        `It begins: ${stripMarkup(raw).slice(0, 120) || '(unreadable)'}`,
    );
  }
}

/**
 * `fetch`, but bounded — the fix for a systemic gap found 2026-08-30: a grep
 * audit of every pack's `mcps/*\/src/index.ts` found 1,339 of ~1,500 call
 * `fetch()` with NO timeout guard anywhere in the file. Two of those
 * (epo-ops, statcan) were confirmed live-hanging for 4-8 minutes before this
 * existed — every unguarded call carries the same risk, just unconfirmed.
 *
 * Mirrors the `epoFetch` wrapper `mcps/epo-ops/src/index.ts` shipped first:
 * bound the request with `AbortSignal.timeout`, and on a timeout/abort throw
 * an `upstream_down:` error that names the upstream and the bound rather than
 * letting the raw `TimeoutError`/`AbortError` (which names neither) propagate.
 * `upstream_down:` is deliberate, same reasoning as `parseJson` above — no
 * argument a caller passes can make an upstream hang, so it is always the
 * upstream's fault, and marking it that way keeps a slow API off the
 * problem-tools list where it would crowd out our own defects.
 *
 * Usage — a mechanical swap for a bare `fetch(url, init)`:
 *
 *     const res = await fetchWithTimeout(url, init, 'Some API');
 *
 * Pass `timeoutMs` as a fourth argument to override the default for a pack
 * with a known-slower upstream; the label should be the same short name you'd
 * pass to `httpError`/`httpErrorMessage` for that call.
 */
async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  name: string,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      // States the OBSERVATION (no response in N seconds), not a diagnosis.
      // "appears to be degraded" is an inference about the vendor that we have
      // not checked, and it is wrong in a way that misdirects whoever reads it:
      // a timeout from a Worker can equally mean OUR egress is blocked.
      //
      // Measured today (2026-09-01, fleet #1047): every call to
      // mainnet.base.org failed from the x402 facilitator while the identical
      // request from a laptop returned 200. Base was entirely healthy; the
      // public RPC refuses Cloudflare Worker egress. Had this message fired
      // there it would have blamed Base by name, and the next person would have
      // waited for a vendor outage to clear that did not exist.
      // A timeout has no status to test — there is no response at all — so
      // `markInternalOrigin` is called without one: an origin we run that never
      // answered is an availability failure by definition. This is the half of
      // fleet #1096 with neither a SQLSTATE nor a status code to key on.
      throw new Error(
        markInternalOrigin(
          `upstream_down: ${name} did not respond within ${timeoutMs / 1000}s. ` +
            `That can be ${name} being slow or down, or this environment being unable to reach it ` +
            `(some hosts refuse datacenter/Worker egress) — retry shortly, and check reachability ` +
            `from elsewhere before concluding ${name} is down.`,
          url,
        ),
      );
    }
    // Fleet #2382. Everything that isn't a timeout/abort here is a genuine
    // NETWORK-LEVEL failure — DNS resolution, connection refused, TLS handshake,
    // Cloudflare's own "Network connection lost." — meaning `fetch()` itself
    // threw and no HTTP response of any kind was ever received. Until this fix
    // that raw exception was rethrown VERBATIM: a bare `TypeError: fetch failed`
    // (or the Workers-runtime equivalent) names no upstream, carries no class
    // token, and reads exactly like a defect in OUR code — because it says
    // nothing about the call at all. It landed in `error`, the tier that means
    // "Pipeworx has a defect", for every one of the (at the time of writing)
    // ~470 packs that call this helper directly with no wrapper of their own.
    //
    // `dexscreener` hit this independently (fleet #1579) and fixed it with a
    // bespoke per-pack try/catch around `fetchWithTimeout`. That fix is correct
    // but only covers one pack; every other caller of this shared helper still
    // leaked the raw exception. Moving the same fix HERE — the one place that
    // already carries the timeout case — covers every pack that uses
    // `fetchWithTimeout` without a wrapper, for free, and without widening
    // `classifyToolError`'s regex list: the fix is giving the message a proper
    // `upstream_down:` token at the point the two facts (no response was ever
    // received, and which host we were trying to reach) are actually in hand,
    // not teaching the classifier to guess from prose after the fact.
    //
    // Safe on the same grounds as the timeout branch above: no argument a
    // caller passes can make `fetch()` itself throw a connection-level error,
    // so this is always an availability failure, never a caller mistake. Same
    // `markInternalOrigin` treatment — an origin we run that never answered is
    // still ours, not a third party's outage.
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(
      markInternalOrigin(
        `upstream_down: could not reach ${name} at all (${raw.slice(0, 160)}). ` +
          `No request reached ${name}, so this says NOTHING about whether the arguments you passed ` +
          'are valid — do not re-check them on the strength of this error. Retry shortly.',
        url,
      ),
    );
  }
}

function detailSuffix(detail: string): string {
  return detail ? ` — ${detail}` : '';
}

async function readDetail(res: Response): Promise<string> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    // Body already consumed, or the connection died mid-read. The status alone
    // is still worth throwing — never let the error path throw its own error.
    return '';
  }
  return summarizeErrorBody(raw);
}

/**
 * Turn ANY error body — JSON, HTML, XML or plain text — into one short phrase
 * that never contains markup.
 *
 * This used to just drop an HTML or XML body on the floor, on the reasoning
 * that markup crowds out the status. That was half right. Dropping it loses the
 * one sentence a caller could have acted on: an `Access Denied` title, an SDMX
 * `<message:Error>` text, an OPS fault string. A 2026-08-30 support sweep
 * measured 13 of 291 caller-facing error rows carrying a raw page or document
 * verbatim, across 11 packs, and in every one of them the useful content —
 * "Access Denied", "Invalid country code", "SCRAPE_TIMEOUT" — was in there,
 * buried in markup the agent had to parse out of a string (fleet #712).
 *
 * So: extract the meaning, discard the markup. The output is passed through
 * `stripMarkup` unconditionally, which is what lets `check:error-body-leak`
 * assert mechanically that no caller-facing message can contain `<?xml`,
 * `<!DOCTYPE` or `<html`.
 */
function summarizeErrorBody(raw: string): string {
  if (!raw || !raw.trim()) return '';

  const head = raw.slice(0, 400).trimStart().toLowerCase();

  // An HTML error page (Cloudflare interstitial, nginx default, a login
  // redirect) says what it is in its <title>, and almost nowhere else.
  if (head.startsWith('<!doctype') || head.startsWith('<html')) {
    const title = htmlTitle(raw);
    return title
      ? `${title} (upstream returned an HTML error page, not an API response)`
      : 'upstream returned an HTML error page, not an API response';
  }

  // XML fault documents — EPO OPS, SDMX (`<message:Error>`), SOAP faults. The
  // human sentence sits in a child element whose tag name says what it is.
  if (head.startsWith('<?xml') || head.startsWith('<')) {
    const fault = xmlFaultText(raw);
    return fault
      ? `${stripMarkup(fault).slice(0, MAX_DETAIL)} (from the upstream's XML error document)`
      : 'upstream returned an XML error document with no readable message';
  }

  // Most JSON error bodies bury one human sentence among ids and echoed request
  // params. Prefer that sentence; fall back to the whole body when the shape is
  // unfamiliar, since an unfamiliar shape is exactly when we can least afford to
  // guess wrong and show nothing.
  const fromJson = messageFromJson(raw);
  return stripMarkup(fromJson ?? raw).slice(0, MAX_DETAIL);
}

/** The `<title>` of an HTML error page, or its first `<h1>` — the two places a
 *  bot wall, a 502 and an "Access Denied" all state what happened. */
function htmlTitle(raw: string): string | null {
  const head = raw.slice(0, 4000);
  for (const re of [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i]) {
    const m = re.exec(head);
    const text = m ? stripMarkup(m[1]) : '';
    if (text) return text.slice(0, 160);
  }
  return null;
}

/** Tag names that carry the explanation in an XML fault document, namespace
 *  prefix optional (`<message:Error>`, `<com:Text>`, `<faultstring>`). */
const XML_FAULT_TAG_RE =
  /<(?:[A-Za-z0-9_.-]+:)?(?:text|message|description|faultstring|reason|detail|title|errormessage|error)\b[^>]*>([^<]{2,400})</i;

function xmlFaultText(raw: string): string | null {
  const head = raw.slice(0, 8000);
  const tagged = XML_FAULT_TAG_RE.exec(head);
  if (tagged && tagged[1].trim()) return tagged[1];

  // Nothing conventionally named — take the longest text node instead. A fault
  // document with one sentence in an oddly named element is still readable;
  // returning nothing at all is not.
  let best = '';
  for (const m of head.matchAll(/>([^<>]{8,400})</g)) {
    const text = m[1].trim();
    if (text.length > best.length) best = text;
  }
  return best || null;
}

/**
 * Remove every tag and stray angle bracket, then collapse whitespace.
 *
 * Applied to everything on the way out, including the JSON and plain-text
 * paths, because an upstream is free to embed markup in a JSON string field —
 * and a leak is a leak regardless of which branch produced it.
 */
function stripMarkup(s: string): string {
  return collapse(decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/[<>]/g, ' '));
}

/** The handful of entities that show up in error-page titles. Decoded AFTER
 *  tags are stripped and BEFORE the angle-bracket sweep, so `&lt;script&gt;`
 *  in a title cannot decode into markup that survives — EMBL-EBI's ChEMBL 500
 *  page renders as `500 Internal Server Error &lt; EMBL-EBI` otherwise. */
function decodeEntities(s: string): string {
  return s
    .replace(/&(?:amp|#0*38);/gi, '&')
    .replace(/&(?:lt|#0*60);/gi, '<')
    .replace(/&(?:gt|#0*62);/gi, '>')
    .replace(/&(?:quot|#0*34);/gi, '"')
    .replace(/&(?:#0*39|apos|#x0*27);/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

/** The conventional "what went wrong" field, under any of the names upstreams
 *  actually use. Checked in order; first non-empty string wins. */
const MESSAGE_KEYS = [
  'message', 'error_message', 'errorMessage', 'detail', 'details',
  'description', 'error_description', 'reason', 'title', 'fault',
];

function messageFromJson(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return pickMessage(parsed, 0);
}

function pickMessage(node: unknown, depth: number): string | null {
  // Two levels covers `{error: {message}}` and `{errors: [{detail}]}`, the two
  // shapes that account for nearly all of them, without walking a large payload.
  if (depth > 2 || node == null) return null;

  if (typeof node === 'string') return node.trim() || null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = pickMessage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;

  for (const key of MESSAGE_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // `{error: …}` where error is itself an object or a string — the single most
  // common wrapper, so it is worth descending into by name rather than scanning
  // every key and risking picking up an echoed request parameter.
  for (const key of ['error', 'errors', 'fault', 'Error', 'data']) {
    if (key in obj) {
      const found = pickMessage(obj[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Errors are read in a single line of log output; newlines and runs of
 *  whitespace make a multi-line body unreadable there. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
/**
 * EPO Open Patent Services MCP
 *
 * Auth: OAuth2 client_credentials. _apiKey = "<consumer_key>:<consumer_secret>".
 * Bearer token cached per consumer_key (20-min TTL).
 *
 * API docs: https://developers.epo.org/
 * Base: https://ops.epo.org/3.2/rest-services/
 *
 * Free tier: 4 GB/week download quota; rate-limited to 10 req/min.
 */


const TOKEN_URL = 'https://ops.epo.org/3.2/auth/accesstoken';
const API_URL = 'https://ops.epo.org/3.2/rest-services';

// EPO OPS has no timeout of its own, and when it degrades it does not error —
// it just never answers. Measured 2026-08-30: the same single-word query that
// once returned in under a second later hung for 243s and 504s with nothing
// back, and search terms hung for the caller's entire wait. Bound every fetch
// in this pack to one number so a degraded upstream fails fast with a message
// instead of holding the caller for four to eight minutes.
const EPO_TIMEOUT_MS = 25_000;

const NUMBER_ARG_DESCRIPTION =
  'Publication number as printed on the document, e.g. "EP1234567", "CN117928705A", "US10000000". Spaces, commas and slashes are ignored, and a trailing kind code (the "A" / "A1" / "B1" suffix) is retried without it if the exact form is not indexed.';

const tools: McpToolExport['tools'] = [
  {
    name: 'search_patents',
    description:
      'Search published patents worldwide via EPO OPS and get back full bibliographic records — title, applicants, inventors, publication date, country, IPC classifications — for each hit. Searches EPO DOCDB, which indexes publications from 100+ patent offices, so Chinese, Japanese, Korean and US documents are all in scope alongside European ones. Each hit\'s `kind` code tells you what stage it is: an "A"-prefixed kind (A1, A2, A3…) is a published APPLICATION, not yet granted; a "B"-prefixed kind (B1, B2…) is a GRANTED patent. Results are not filtered to grants by default — most hits from a bare keyword search will be "A" kind. To find issued/granted patents specifically, scope the query with a kind or grant-relevant field (e.g. add `AND pd>=<date>` and check `kind` on the returned rows) rather than assuming an unfiltered hit is granted. Example queries: "ta=hydrogen", "in=Tesla", "pa=apple", "txt=neural network AND pd>=2020".',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'EPO CQL — fields: ta (title-abstract), ti (title), ab (abstract), txt (any text), in (inventor), pa (applicant), cl (classification), pn (publication number), ap (application number), pr (priority), pd (publication date), ad (application date).',
        },
        range: {
          type: 'string',
          description: 'Result range "start-end" (1-indexed). Max 100 per page. Default "1-25".',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_biblio',
    description:
      'Bibliographic data for one published patent — title, inventors, applicants, publication date, IPC classifications. Drawn from EPO DOCDB, which covers 100+ patent offices, so Chinese, Japanese, Korean and US publications resolve as well as European ones. Give the publication number as printed on the document; a trailing kind code such as the "A" in "CN117928705A" is handled for you.',
    inputSchema: {
      type: 'object',
      properties: {
        number: { type: 'string', description: NUMBER_ARG_DESCRIPTION },
      },
      required: ['number'],
    },
  },
  {
    name: 'get_family',
    description:
      'INPADOC family — every related patent publication worldwide covering the same underlying invention, which is how you find the Chinese, Japanese, US and European members of one filing. Give the publication number as printed on the document; a trailing kind code is handled for you.',
    inputSchema: {
      type: 'object',
      properties: {
        number: { type: 'string', description: NUMBER_ARG_DESCRIPTION },
      },
      required: ['number'],
    },
  },
  {
    name: 'get_abstract',
    description:
      'Fetch the abstract text of a published patent from EPO OPS. Give the publication number as printed on the document; a trailing kind code is handled for you. Requires _apiKey=consumer_key:consumer_secret.',
    inputSchema: {
      type: 'object',
      properties: {
        number: { type: 'string', description: NUMBER_ARG_DESCRIPTION },
      },
      required: ['number'],
    },
  },
  {
    name: 'get_claims',
    description:
      'Fetch the full claims text of a published patent from EPO OPS. EPO\'s full-text collection is narrower than its bibliographic one — European (EP) and PCT (WO) publications have the broadest claims coverage, and a publication outside that collection comes back as found:false naming get_biblio as the route to its title, applicants and abstract. Give the publication number as printed on the document; a trailing kind code is handled for you. Requires _apiKey=consumer_key:consumer_secret.',
    inputSchema: {
      type: 'object',
      properties: {
        number: { type: 'string', description: NUMBER_ARG_DESCRIPTION },
      },
      required: ['number'],
    },
  },
];

interface CachedToken {
  access_token: string;
  expires_at: number;
}
const TOKEN_CACHE = new Map<string, CachedToken>();
const TOKEN_TTL_MS = 18 * 60 * 1000; // refresh slightly before EPO's 20-min lifetime

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const apiKey = (args._apiKey as string | undefined)?.trim();
  if (!apiKey) {
    throw new Error(
      'EPO OPS requires OAuth credentials. Pass ?_apiKey=<consumer_key>:<consumer_secret>. Register at https://developers.epo.org/.',
    );
  }
  const colon = apiKey.indexOf(':');
  if (colon < 1 || colon === apiKey.length - 1) {
    throw new Error('EPO _apiKey must be "consumer_key:consumer_secret".');
  }
  const k = apiKey.slice(0, colon);
  const s = apiKey.slice(colon + 1);
  const token = await getAccessToken(k, s);

  switch (name) {
    case 'search_patents':
      return searchPatents(token, args);
    case 'get_biblio': {
      const r = await fetchByNumber(token, reqStr(args, 'number', '"EP1234567"'), (n) =>
        `/published-data/publication/epodoc/${n}/biblio`);
      if (!r.found) return notIndexed(r, 'Bibliographic data');
      const docs = collectExchangeDocs(r.data).map(flattenExchangeDoc);
      return {
        found: true,
        ...numberEcho(r),
        // One publication number can carry several kind codes (the A
        // application and the B grant are separate documents), so this stays a
        // list rather than collapsing to whichever came back first.
        publications: docs,
        ...(docs.length === 0 ? { note: 'EPO returned a record with no bibliographic document in it.', raw: r.data } : {}),
      };
    }
    case 'get_family': {
      const r = await fetchByNumber(token, reqStr(args, 'number', '"EP1234567"'), (n) =>
        `/family/publication/epodoc/${n}`);
      if (!r.found) return notIndexed(r, 'INPADOC family data');
      return { found: true, ...numberEcho(r), family: r.data };
    }
    case 'get_abstract': {
      const r = await fetchByNumber(token, reqStr(args, 'number', '"EP1234567"'), (n) =>
        `/published-data/publication/epodoc/${n}/abstract`);
      if (!r.found) {
        return notIndexed(r, 'An abstract', 'get_biblio returns this publication\'s title, applicants, inventors and classifications, and often carries the abstract with them.');
      }
      const text = textOf(deepFind(r.data, 'abstract'));
      return { found: true, ...numberEcho(r), abstract: text || null, ...(text ? {} : { raw: r.data }) };
    }
    case 'get_claims': {
      const r = await fetchByNumber(token, reqStr(args, 'number', '"EP1234567"'), (n) =>
        `/published-data/publication/epodoc/${n}/claims`);
      if (!r.found) {
        // EPO's full-text collection is much narrower than its bibliographic
        // one. A CN or US publication that is perfectly well indexed in DOCDB
        // has no claims here, and the bare 404 this used to throw read as "no
        // such patent" — so an agent gave up on a document we could have
        // described. Say which of the two it is.
        return notIndexed(
          r,
          'Claim text',
          'EPO\'s full-text service covers a subset of what it indexes bibliographically, with European (EP) and PCT (WO) publications the best covered. Call get_biblio for this number to get its title, applicants, inventors and classifications, or get_family to find an EP or WO member of the same invention whose claims are available.',
        );
      }
      const claims = extractClaims(r.data);
      return {
        found: true,
        ...numberEcho(r),
        claim_count: claims.length,
        claims,
        ...(claims.length === 0 ? { note: 'EPO returned a full-text record with no claim elements in it.', raw: r.data } : {}),
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/**
 * fetch() with a hard deadline. EPO OPS degrading does not error — it just
 * stops answering — so every call in this pack goes through here rather than
 * calling fetch() directly. A caller gets a fast, named failure instead of a
 * multi-minute hang, and the message says which upstream operation it was.
 */
async function epoFetch(url: string, init: RequestInit, label: string): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(EPO_TIMEOUT_MS) });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new Error(
        `upstream_down: EPO did not respond within ${EPO_TIMEOUT_MS / 1000}s (${label}). ` +
          'EPO OPS appears to be degraded right now — retry shortly.',
      );
    }
    throw err;
  }
}

async function getAccessToken(key: string, secret: string): Promise<string> {
  const cached = TOKEN_CACHE.get(key);
  if (cached && cached.expires_at > Date.now()) return cached.access_token;
  const basic = btoa(`${key}:${secret}`);
  const res = await epoFetch(
    TOKEN_URL,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: 'grant_type=client_credentials',
    },
    'requesting an access token',
  );
  if (!res.ok) throw await httpError(res, 'EPO OAuth');
  const data = (await res.json()) as { access_token?: string; expires_in?: string | number };
  if (!data.access_token) throw new Error('EPO OAuth: response missing access_token');
  const ttl = (Number(data.expires_in) || 1200) * 1000;
  TOKEN_CACHE.set(key, {
    access_token: data.access_token,
    expires_at: Date.now() + Math.min(ttl, TOKEN_TTL_MS),
  });
  return data.access_token;
}

async function epoGet<T = unknown>(token: string, path: string, params?: URLSearchParams): Promise<T> {
  const url = `${API_URL}${path}${params?.toString() ? `?${params}` : ''}`;
  const res = await epoFetch(
    url,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
    path,
  );
  if (res.status === 404) throw new Error(`EPO: not found (${path})`);
  if (res.status === 401 || res.status === 403) throw new Error('EPO: unauthorized — check credentials');
  if (res.status === 429) throw new Error('upstream_throttled: EPO rate-limit (HTTP 429).');
  if (res.status === 413) {
    // EPO's own body for this is an XML fault document. upstreamDetail lifts
    // the <message> text out of it, so the agent gets EPO's actual reason
    // ("Not enough characters before truncation character") rather than either
    // a raw `<?xml version="1.0" ...` fragment or a bare restatement of the
    // status we just printed (fleet #712).
    const why = await upstreamDetail(res);
    throw new Error(
      `EPO rejected this request as too large (HTTP 413)${why ? ` — ${why}` : ''}. ` +
        'Narrow it: a shorter number list, a smaller range, or a more selective query.',
    );
  }
  if (!res.ok) throw await httpError(res, 'EPO');
  return res.json() as Promise<T>;
}

async function searchPatents(token: string, args: Record<string, unknown>) {
  const rawQuery = String(args.query);
  const range = (args.range as string) ?? '1-25';

  // Two of EPO's HTTP 413 rejections are deterministic and cheaper to catch
  // before we ever spend the 10-req/min quota on them (fleet #736 — a single
  // caller looped 12 times through both shapes, and our old advice — "narrow
  // the query" — was already true of half those attempts, which is why it
  // never landed):
  //
  // 1. A truncation wildcard with too few literal characters before it. EPO's
  //    own rule: >=3 chars before `*`, >=2 before `?`/`#`. `pn=CN*` and
  //    `pa=V*rt*ex` both hit this — checking it locally turns a round trip
  //    that ALWAYS 413s into an instant, structured refusal.
  const shortTruncation = findShortTruncation(rawQuery);
  if (shortTruncation) {
    return {
      found: false,
      reason: 'truncation_too_short',
      query: rawQuery,
      message:
        `"${shortTruncation.token}" has only ${shortTruncation.token.length - 1} character(s) before the ` +
        `'${shortTruncation.mark}' wildcard; EPO requires at least ${shortTruncation.needed}. Checked locally — EPO was not called.`,
      hint: `Add more literal characters before the wildcard, e.g. "pa=Vertex*" rather than "pa=V*".`,
    };
  }

  // 2. A date-range CQL clause written as `field>=start AND field<=end`. EPO
  //    calls this "FuzzyDateRanges" and 413s it outright — its own fault
  //    message names the fix (`field within "start,end"`), so rewrite
  //    automatically rather than making the caller re-derive EPO's own syntax
  //    from a sentence. This was the dominant failure behind #736: 9 of a
  //    single caller's 12 errors were exactly this shape, tried nine
  //    different ways, none of which touched the actual problem.
  const dateRewrite = narrowFuzzyDateRange(rawQuery);
  const queryToSend = dateRewrite ? dateRewrite.rewritten : rawQuery;

  const params = new URLSearchParams({ q: queryToSend });
  // `/search` returns publication numbers and nothing else — 25 bare identifiers
  // wrapped in ~10 KB of XML namespace scaffolding, with no title to tell them
  // apart. Every caller then had to spend a second call per hit just to learn
  // what it had found, against a 10 req/min quota. `/search/biblio` is the same
  // search with the bibliographic constituent attached, so one call answers the
  // question that was actually asked.
  const url = `${API_URL}/published-data/search/biblio?${params}`;
  const res = await epoFetch(
    url,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-OPS-Range': range } },
    `search "${queryToSend}"`,
  );
  if (res.status === 404) {
    // EPO reports an empty result set as HTTP 404. That is an answer, not a
    // failure — throwing here booked every zero-match search as OUR error and
    // put this tool on the problem-tools list.
    return {
      found: false,
      total: 0,
      results: [],
      ...(dateRewrite ? { query: dateRewrite.rewritten, original_query: rawQuery } : {}),
      note: `No published patents matched ${JSON.stringify(queryToSend)}. EPO uses strict CQL: quote multi-word phrases, or scope with ti="…" (title) / ta="…" (title+abstract).`,
    };
  }
  if (res.status === 401 || res.status === 403) throw new Error('EPO: unauthorized');
  if (res.status === 429) throw new Error('upstream_throttled: EPO rate-limit (HTTP 429).');
  if (res.status === 413) {
    // Same fault-document shape as epoGet's 413 — the errors behind #736 were
    // all here, on search_patents. This used to throw, which booked every one
    // of these as a Pipeworx error and put the tool on the problem-tools list
    // for a caller mistake we can name precisely. Returning `found:false`
    // instead classifies it as `empty` (same reasoning as the 404 branch
    // above) and gives the agent a field to read the fix out of, not just a
    // sentence to re-parse.
    const why = await upstreamDetail(res);
    return {
      found: false,
      reason: 'query_too_broad',
      query: rawQuery,
      ...(dateRewrite
        ? {
            // We already tried EPO's own fix and it STILL 413'd — say so
            // rather than repeating advice that provably didn't work.
            attempted_rewrite: dateRewrite.rewritten,
            message:
              `EPO rejected this search as too large (HTTP 413), including after automatically narrowing the date ` +
              `range to "${dateRewrite.rewritten}"${why ? ` — ${why}` : ''}.`,
            hint: 'Scope further with a more selective field (ti=/ta=/pa=/in=) or a smaller date range; a bare word or a multi-year window is still too broad for EPO even with `within` syntax.',
          }
        : {
            message: `EPO rejected this search as too large (HTTP 413)${why ? ` — ${why}` : ''}.`,
            hint: /range/i.test(why)
              ? `EPO's own message names the fix — use its suggested syntax (e.g. "pd within \\"start,end\\"" instead of "pd>=start AND pd<=end").`
              : 'Narrow the query: a more selective CQL field (ti=/ta=/pa=/in= instead of a bare word) or a smaller result range.',
          }),
    };
  }
  if (!res.ok) throw await httpError(res, 'EPO');
  const data = await res.json();
  const search = deepFind(data, 'ops:biblio-search') ?? deepFind(data, 'ops:search-result');
  const total = Number(asRecord(search)?.['@total-result-count'] ?? NaN);
  const results = collectExchangeDocs(data).map(flattenExchangeDoc);
  return {
    found: results.length > 0,
    query: queryToSend,
    ...(dateRewrite
      ? {
          original_query: rawQuery,
          note_query_rewritten:
            'EPO rejects "field>=X AND field<=Y" date ranges as too broad (FuzzyDateRanges); this was automatically ' +
            `rewritten to "${dateRewrite.rewritten}" before it was sent, and that rewritten form is what actually ran.`,
        }
      : {}),
    range,
    total: Number.isFinite(total) ? total : results.length,
    returned: results.length,
    results,
    ...(results.length === 0
      ? {
          // A search that matched but whose documents we could not read is a
          // different problem from a search that matched nothing, and the raw
          // payload is what tells them apart.
          note: 'EPO reported matches but returned no readable bibliographic documents.',
          raw: data,
        }
      : {}),
    // fleet #2324 tried a `next: get_family` hint here (169 distinct
    // single-shot external callers in 30d). REVERTED — verified live twice:
    // get_family({number: results[0].publication_number}) returned
    // found:false ("publication_not_in_this_collection") on the actual top
    // hit for two different real queries ("ta=hydrogen fuel cell",
    // "pa=Tesla AND pd>=2020"), both because EPO's own relevance ranking
    // tends to surface the NEWEST matching publication first and INPADOC's
    // family index lags fresh publications by days-to-weeks. get_claims has
    // the same reliability problem from the other direction — coverage is
    // EP/WO-only, and results[0] is exactly as likely to be a US/CN/JP
    // document. get_biblio always succeeds but is redundant with the fields
    // already in this response. No candidate next step is reliable across an
    // arbitrary top hit, so this stays without a `next` hint — a wrong hint
    // that fires on a meaningful share of real queries is worse than none.
  };
}

/**
 * Prefix-length check for CQL truncation wildcards, ahead of EPO's own.
 * EPO requires >=3 literal characters before `*` and >=2 before `?`/`#`
 * (its fault text: "Not enough characters before truncation character").
 * Checked locally so a query that can never succeed doesn't spend the
 * 10-req/min quota finding that out.
 */
const MIN_TRUNCATION_PREFIX: Record<string, number> = { '*': 3, '?': 2, '#': 2 };
const TRUNCATION_RE = /([A-Za-z0-9À-ÿ]*)([*?#])/g;
function findShortTruncation(query: string): { token: string; mark: string; needed: number } | null {
  TRUNCATION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TRUNCATION_RE.exec(query))) {
    const [, prefix, mark] = m;
    const needed = MIN_TRUNCATION_PREFIX[mark];
    if (prefix.length < needed) return { token: `${prefix}${mark}`, mark, needed };
  }
  return null;
}

/**
 * Rewrite a `field>=start AND field<=end` (or `<`/`>`) date-range clause to
 * the `field within "start,end"` syntax EPO's own FuzzyDateRanges fault
 * message asks for. Only touches the matched clause — the rest of the query
 * (ti=/ta=/pa=/in= scoping) passes through untouched. `pd`/`pr`/`ad` are the
 * date-shaped fields in this tool's schema; `ad` also happens to be an
 * invalid index on this endpoint (a separate bug), but the rewrite is inert
 * either way since that query 400s before this would matter.
 */
const FUZZY_DATE_RANGE_RE =
  /\b(pd|pr|ad)\s*(>=|>)\s*"?(\d{4}(?:-\d{2}-\d{2}|\d{4})?)"?\s+AND\s+\1\s*(<=|<)\s*"?(\d{4}(?:-\d{2}-\d{2}|\d{4})?)"?/i;
function narrowFuzzyDateRange(query: string): { rewritten: string; field: string; start: string; end: string } | null {
  const m = FUZZY_DATE_RANGE_RE.exec(query);
  if (!m) return null;
  const [full, field, , start, , end] = m;
  const replacement = `${field} within "${start},${end}"`;
  return {
    rewritten: query.slice(0, m.index) + replacement + query.slice(m.index + full.length),
    field,
    start,
    end,
  };
}

// ── EPO response helpers ─────────────────────────────────────────────
//
// OPS answers in XML rendered to JSON, so every text node arrives as `{"$":
// "value"}`, every attribute as `@name`, and anything that can repeat is a bare
// object when there is one of it and an array when there are several. Walking
// that by fixed path breaks on the singular case, which is why these helpers
// search by key instead.

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asArray<T = unknown>(v: unknown): T[] {
  if (v == null) return [];
  return (Array.isArray(v) ? v : [v]) as T[];
}

/** First value stored under `key` anywhere in the tree, depth-first. */
function deepFind(node: unknown, key: string): unknown {
  if (node == null || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = deepFind(item, key);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  const rec = node as Record<string, unknown>;
  if (key in rec) return rec[key];
  for (const v of Object.values(rec)) {
    const hit = deepFind(v, key);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** Every value stored under `key` anywhere in the tree, flattened. */
function deepFindAll(node: unknown, key: string, out: unknown[] = []): unknown[] {
  if (node == null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) deepFindAll(item, key, out);
    return out;
  }
  const rec = node as Record<string, unknown>;
  for (const [k, v] of Object.entries(rec)) {
    if (k === key) out.push(...asArray(v));
    else deepFindAll(v, key, out);
  }
  return out;
}

/** Concatenate every text node in a subtree, in document order. */
function textOf(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).filter(Boolean).join(' ').trim();
  const rec = asRecord(node);
  if (!rec) return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(rec)) {
    if (k.startsWith('@')) continue; // attributes are metadata, not prose
    parts.push(textOf(v));
  }
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function collectExchangeDocs(data: unknown): Record<string, unknown>[] {
  return deepFindAll(data, 'exchange-document')
    .map(asRecord)
    .filter((d): d is Record<string, unknown> => d !== null);
}

/** Prefer the English title when a document carries several languages. */
function pickTitle(doc: unknown): string | null {
  const titles = asArray(deepFind(doc, 'invention-title'));
  if (titles.length === 0) return null;
  const english = titles.find((t) => asRecord(t)?.['@lang'] === 'en');
  const chosen = english ?? titles[0];
  return textOf(chosen) || null;
}

function namesUnder(doc: unknown, group: string, item: string): string[] {
  const groupNode = deepFind(doc, group);
  if (groupNode == null) return [];
  const names = deepFindAll(groupNode, item)
    // Each party is listed once per data format (docdb and epodoc), so the same
    // name would otherwise appear twice in every record.
    .map((p) => textOf(deepFind(p, 'name')))
    .filter(Boolean);
  return [...new Set(names)];
}

/**
 * EPO pads IPC symbols to a fixed width and appends position flags, so one
 * arrives as `"B28B   1/    29            A I"`. Deleting the whitespace turns
 * that into "B28B1/29AI" — the flags silently glued to the symbol, which is not
 * a code anybody can look up. Pull the symbol out and drop the flags.
 */
function compactIpc(raw: string): string {
  const squeezed = raw.replace(/\s+/g, '');
  const symbol = squeezed.match(/^[A-Z]\d{2}[A-Z]\d+\/\d+/);
  return symbol ? symbol[0] : raw.replace(/\s+/g, ' ').trim();
}

function flattenExchangeDoc(doc: Record<string, unknown>) {
  const country = typeof doc['@country'] === 'string' ? doc['@country'] : null;
  const docNumber = doc['@doc-number'] != null ? String(doc['@doc-number']) : null;
  const kind = typeof doc['@kind'] === 'string' ? doc['@kind'] : null;
  const pubRef = deepFind(doc, 'publication-reference');
  const dateNode = pubRef ? deepFind(pubRef, 'date') : undefined;
  const date = textOf(dateNode);
  const classifications = deepFindAll(deepFind(doc, 'classifications-ipcr'), 'text')
    .map((t) => compactIpc(textOf(t)))
    .filter(Boolean);
  const abstract = textOf(deepFind(doc, 'abstract'));
  return {
    publication_number: country && docNumber ? `${country}${docNumber}${kind ?? ''}` : null,
    country,
    kind,
    family_id: doc['@family-id'] != null ? String(doc['@family-id']) : null,
    title: pickTitle(doc),
    // OPS dates are YYYYMMDD; hand back ISO so callers can compare them.
    publication_date: /^\d{8}$/.test(date) ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : (date || null),
    applicants: namesUnder(doc, 'applicants', 'applicant'),
    inventors: namesUnder(doc, 'inventors', 'inventor'),
    ipc_classifications: [...new Set(classifications)].slice(0, 20),
    abstract: abstract || null,
  };
}

function extractClaims(data: unknown): string[] {
  const claimsNode = deepFind(data, 'claims');
  if (claimsNode == null) return [];
  // Which element separates one claim from the next varies by document. EP1000000
  // returns ONE `claim` element holding eleven `claim-text` children, so counting
  // `claim` reported "claim_count: 1" over a 2,455-character string with all
  // eleven run together — a caller asking "what does claim 3 say" would have had
  // to parse that back out themselves. Take whichever element actually divides
  // them.
  const claimTexts = deepFindAll(claimsNode, 'claim-text');
  const claimElements = deepFindAll(claimsNode, 'claim');
  const source = claimTexts.length >= claimElements.length ? claimTexts : claimElements;
  return (source.length > 0 ? source : [claimsNode]).map(textOf).filter(Boolean);
}

/**
 * Fetch by publication number, retrying without the kind-code suffix.
 *
 * The number printed on a patent carries a kind code — the "A" in
 * "CN117928705A" — and OPS's epodoc lookup rejects it, so the form a caller
 * physically reads off the document was the one form that 404'd. Try what they
 * gave us first (it is the more precise request when it is indexed), then the
 * stripped form, and report which one answered.
 */
interface NumberFetch {
  found: boolean;
  requested: string;
  resolved: string | null;
  tried: string[];
  data?: unknown;
}

async function fetchByNumber(
  token: string,
  raw: string,
  buildPath: (n: string) => string,
): Promise<NumberFetch> {
  const cleaned = raw.toUpperCase().replace(/[\s,/]/g, '');
  const candidates = [cleaned];
  const stripped = cleaned.replace(/^([A-Z]{2}\d+)[A-Z]\d?$/, '$1');
  if (stripped !== cleaned) candidates.push(stripped);

  for (const candidate of candidates) {
    try {
      const data = await epoGet(token, buildPath(encodeURIComponent(candidate)));
      return { found: true, requested: raw, resolved: candidate, tried: candidates, data };
    } catch (err) {
      // Only a genuine "not indexed" is worth retrying in another form; auth,
      // quota and transport failures must surface as themselves.
      if (!(err instanceof Error) || !/not found/i.test(err.message)) throw err;
    }
  }
  return { found: false, requested: raw, resolved: null, tried: candidates };
}

function numberEcho(r: NumberFetch) {
  return {
    requested_number: r.requested,
    // Say which form actually answered — a caller comparing results across
    // numbers needs to know we looked up something other than what they typed.
    resolved_number: r.resolved,
  };
}

function notIndexed(r: NumberFetch, what: string, hint?: string) {
  return {
    found: false,
    reason: 'publication_not_in_this_collection',
    requested_number: r.requested,
    numbers_tried: r.tried,
    message: `${what} for "${r.requested}" is not in the EPO OPS collection this tool reads.`,
    hint:
      hint ??
      'Check the publication number, or search for the document with search_patents (e.g. pn=EP1234567) to confirm the form EPO indexes it under.',
  };
}

function reqStr(args: Record<string, unknown>, key: string, example: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`Required argument "${key}" is missing. Pass a string like ${example}.`);
  }
  return v;
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;

// Exported for tests. The gateway consumes the default export only; these are
// the pure response-shaping functions, which are the part worth pinning against
// a real EPO payload.
export { collectExchangeDocs, flattenExchangeDoc, extractClaims, compactIpc, textOf, deepFind };
