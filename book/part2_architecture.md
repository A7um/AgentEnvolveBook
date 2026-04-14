# Part II: Architecture Patterns for Production Agents

---

## Chapter 4: Building MCP Servers That Work

### 4.1 A Complete Working MCP Server in 40 Lines

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "deployments",
  version: "1.0.0",
});

server.tool(
  "get_deployment_status",
  "Returns the current deployment status for a service. " +
    "Input: service name as it appears in your Kubernetes namespace " +
    "(e.g., 'api-gateway', 'auth-service'). " +
    "Output: JSON with status, replica count, last deploy timestamp, " +
    "and any error conditions.",
  {
    service: z
      .string()
      .describe("Kubernetes service name, e.g. 'api-gateway'"),
    namespace: z
      .string()
      .default("production")
      .describe("Kubernetes namespace, defaults to 'production'"),
  },
  async ({ service, namespace }) => {
    const res = await fetch(
      `https://deploy.internal/api/v1/status?` +
        `service=${encodeURIComponent(service)}&ns=${encodeURIComponent(namespace)}`
    );
    if (!res.ok) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Failed to fetch status for ${service}: ${res.status} ${res.statusText}`,
          },
        ],
      };
    }
    const data = await res.json();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

Every line in this server exists for a reason. Walk through what matters:

**The `McpServer` constructor** takes a `name` and `version`. The name is how hosts identify this server during capability negotiation. The version follows semver — clients can use it to detect incompatible changes. Do not use creative names. Use the exact name of the system this server wraps: `"deployments"`, `"postgres"`, `"github"`. The model reads this name to decide which server to query.

**The `server.tool()` registration** takes four arguments: tool name, description, Zod schema, and handler function. The description is the single most important line in your entire MCP server. The model reads it on every turn to decide whether to invoke this tool. We will cover description writing in depth in section 4.3.

**The Zod schema** is not optional decoration. The MCP SDK uses it to generate JSON Schema for the tool's `inputSchema` field, which the model reads to understand what parameters are available. Zod's `.describe()` method on individual fields is critical — without it, the model sees parameter names but no guidance on valid values. The `.default("production")` on `namespace` means the model can omit that parameter and get a sensible value, reducing the decision burden per invocation.

**The handler function** receives validated parameters (Zod has already parsed them) and returns a `CallToolResult`. The return type has a specific structure:

```typescript
type CallToolResult = {
  content: Array<TextContent | ImageContent | EmbeddedResource>;
  isError?: boolean;
};
```

The `content` array can contain text, images, or embedded resources. Most tools return a single `TextContent` object. The `isError` field is the subject of section 4.5 — it is how you signal recoverable failures without crashing the server.

**The `StdioServerTransport`** binds this server to stdin/stdout. The host process (Claude Desktop, Cursor, a custom harness) launches this server as a child process, writes JSON-RPC 2.0 messages to its stdin, and reads responses from its stdout. No HTTP, no ports, no certificates — just pipes.

### 4.2 Adding Resources and Prompt Templates

Tools are functions the model invokes. Resources are data the model reads. Prompt templates are predefined workflows the user selects. A production server typically exposes all three.

```typescript
server.resource(
  "deployment-history",
  "deploy://history/{service}",
  {
    description:
      "Deployment history for a service. Returns the last 50 deploys " +
      "with timestamps, commit SHAs, deployer, and rollback status.",
    mimeType: "application/json",
  },
  async (uri) => {
    const service = uri.pathname.split("/").pop();
    const history = await fetch(
      `https://deploy.internal/api/v1/history?service=${service}&limit=50`
    );
    const data = await history.json();
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }
);
```

Resources use URI templates (RFC 6570). The `deploy://history/{service}` template tells the client that this resource is parameterized — the model fills in `{service}` based on context. The `mimeType` hint lets the client render the resource appropriately (syntax highlighting for JSON, markdown rendering for text/markdown, etc.).

When should you use a resource instead of a tool? The rule is simple: **if the model needs to read data but does not need to trigger side effects, use a resource.** Resources are read-only by design. They appear in the client's resource list and can be attached to conversations without a tool call. Tools are for actions — creating, updating, deleting, executing.

Prompt templates are predefined conversation starters:

```typescript
server.prompt(
  "incident-response",
  "Guided incident response workflow for a service outage. " +
    "Walks through status checks, log analysis, and rollback decisions.",
  {
    service: z.string().describe("Affected service name"),
    severity: z.enum(["P0", "P1", "P2"]).describe("Incident severity"),
  },
  async ({ service, severity }) => {
    const status = await fetch(
      `https://deploy.internal/api/v1/status?service=${service}`
    );
    const statusData = await status.json();
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Incident Response for ${service} (${severity})\n\n` +
              `Current status:\n${JSON.stringify(statusData, null, 2)}\n\n` +
              `Walk me through the incident response checklist:\n` +
              `1. Confirm the failure mode from the status data above\n` +
              `2. Check deployment history for recent changes\n` +
              `3. Analyze error logs from the last 30 minutes\n` +
              `4. Recommend: rollback, hotfix, or investigate further`,
          },
        },
      ],
    };
  }
);
```

Prompt templates are underused in practice but powerful for standardizing workflows. They pre-fill the conversation with structured context and guide the model through a specific procedure. Teams that build internal MCP servers often start with tools, discover common multi-step patterns, and extract them into prompts.

### 4.3 Tool Descriptions: Write for the Model, Not for Humans

The tool description is the single highest-leverage string in your MCP server. The model reads it on every turn. A vague description causes misuse. A good description eliminates an entire category of errors.

Here is a bad description:

```
"Manages deployments"
```

The model cannot determine from this whether the tool lists deployments, creates deployments, rolls back deployments, or shows deployment status. It will guess, and it will guess wrong often enough to matter.

Here is the actual description from the server above:

```
"Returns the current deployment status for a service.
Input: service name as it appears in your Kubernetes namespace
(e.g., 'api-gateway', 'auth-service').
Output: JSON with status, replica count, last deploy timestamp,
and any error conditions."
```

This description follows four principles that Anthropic documented in their tool design guidelines and that practitioners have validated through production experience:

**1. State the action verb first.** "Returns", "Creates", "Deletes", "Searches". The model uses this verb to match user intent to tool selection. "Returns the current deployment status" is unambiguous — this tool is for reading, not writing.

**2. Describe valid inputs with examples.** "Service name as it appears in your Kubernetes namespace (e.g., 'api-gateway', 'auth-service')". Without examples, the model might pass a friendly display name ("API Gateway") instead of the actual Kubernetes service name. The examples anchor the model's understanding of the expected format.

**3. Describe what the output looks like.** "JSON with status, replica count, last deploy timestamp, and any error conditions." The model uses this to plan its next step. If it knows the output contains a `replica_count` field, it can extract that value without asking a follow-up question. If the output is opaque, the model wastes a turn interpreting it.

**4. Mention failure conditions.** "Any error conditions" signals that the output may contain error information. More explicitly:

```
"If the service does not exist, returns isError: true with a message
listing similar service names. If the deploy API is unreachable,
returns isError: true with the HTTP status code."
```

This is prompt engineering applied to tool definitions. The same principles that make system prompts effective — specificity, examples, expected output format, failure modes — make tool descriptions effective.

Here is a real comparison. Cloudflare's engineering team reported this finding when building their MCP server for the Cloudflare API: their API has approximately 2,500 endpoints. Exposing each endpoint as a separate tool would consume over 1,000,000 tokens just for the tool definitions. The model would never reach the user's message.

Their solution: two tools.

```typescript
server.tool(
  "search",
  "Search the Cloudflare API for endpoints matching a query. " +
    "Input: natural language description of what you want to do " +
    "(e.g., 'list DNS records', 'create a worker', 'purge cache'). " +
    "Output: up to 10 matching API endpoints with their paths, " +
    "methods, descriptions, and required parameters.",
  { query: z.string().describe("Natural language search query") },
  async ({ query }) => {
    const results = await searchEndpoints(query);
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }
);

server.tool(
  "execute",
  "Execute a Cloudflare API endpoint. " +
    "Input: the endpoint path and method from a search result, " +
    "plus any required parameters. " +
    "Output: the API response.",
  {
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    path: z.string().describe("API path from search results, e.g. '/zones/{zone_id}/dns_records'"),
    pathParams: z.record(z.string()).optional().describe("URL path parameters"),
    queryParams: z.record(z.string()).optional().describe("URL query parameters"),
    body: z.any().optional().describe("Request body for POST/PUT/PATCH"),
  },
  async ({ method, path, pathParams, queryParams, body }) => {
    const response = await executeEndpoint(method, path, pathParams, queryParams, body);
    return {
      content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
    };
  }
);
```

Two tools. Approximately 1,000 tokens for the complete tool list, regardless of how many API endpoints exist behind them. The model searches first, gets the specific endpoint details it needs, then executes. This is the "Code Mode" pattern — expose a search-and-execute interface rather than the full API surface.

The token savings are not marginal. They are the difference between a system that works and a system that fails before reading the user's message:

| Approach | Tools | Token Cost | Context Remaining |
|---|---|---|---|
| One tool per endpoint | 2,500 | ~1,000,000 | None (exceeds window) |
| Grouped by category | ~50 | ~40,000 | ~160K of 200K |
| Search + Execute | 2 | ~1,000 | ~199K of 200K |

### 4.4 The `isError` Pattern: Recoverable vs. Hard Failures

MCP defines two failure mechanisms. Using the wrong one causes the model to either give up prematurely or spin in a retry loop.

**`isError: true` in the return value** signals a recoverable failure. The model receives the error message as content and can decide what to do — retry with different parameters, try a different tool, or explain the error to the user.

```typescript
server.tool(
  "query_database",
  "Execute a read-only SQL query against the analytics database.",
  {
    sql: z.string().describe("SQL SELECT query"),
  },
  async ({ sql }) => {
    try {
      const result = await db.query(sql);
      return {
        content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }],
      };
    } catch (err) {
      if (err.code === "42P01") {
        // Table does not exist
        const tables = await db.query(
          "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
        );
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `Table not found. Error: ${err.message}\n\n` +
                `Available tables:\n${tables.rows.map((r) => r.tablename).join("\n")}`,
            },
          ],
        };
      }
      if (err.code === "42601") {
        // Syntax error
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `SQL syntax error: ${err.message}\n` +
                `Position: ${err.position}\n` +
                `Hint: Check for missing quotes, unmatched parentheses, ` +
                `or reserved keywords used as identifiers.`,
            },
          ],
        };
      }
      // Unknown errors: throw to signal a hard failure
      throw err;
    }
  }
);
```

When the model sends a query referencing a nonexistent table, it receives the error message plus the list of available tables. It can then reformulate the query with the correct table name. This is a recoverable failure — the model has enough information to self-correct.

**Throwing an `McpError` (or any uncaught exception)** signals a hard failure. The transport layer catches it and returns a JSON-RPC error response. The model typically cannot recover from this — the error may be an authentication failure, a server crash, or a protocol violation.

```typescript
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

server.tool(
  "execute_migration",
  "Run a database migration.",
  { migration_id: z.string() },
  async ({ migration_id }) => {
    if (!process.env.MIGRATION_TOKEN) {
      throw new McpError(
        ErrorCode.InternalError,
        "MIGRATION_TOKEN environment variable is not set. " +
          "This server cannot execute migrations without authentication."
      );
    }
    // ...
  }
);
```

The rule of thumb: **if the model can fix it, return `isError: true`. If a human must fix it, throw.** Table not found? Model can fix its query. Authentication missing? Human must set the environment variable.

Production MCP servers that use `isError` correctly see significantly fewer "I'm sorry, I encountered an error" dead ends. The model treats `isError: true` responses as useful information, not terminal failures.

### 4.5 The stdout Pollution Bug

This bug has bitten every team that has built a nontrivial MCP server using the stdio transport. It is subtle, intermittent, and produces impossible-looking error messages.

The stdio transport uses stdout for JSON-RPC messages. The host reads stdout line by line, expecting each line to be a valid JSON-RPC message. If anything else appears on stdout — a log message, a dependency's debug output, a progress bar, a deprecation warning — the host receives a line that is not valid JSON-RPC. It either crashes the connection or silently corrupts the protocol state.

Here is how it looks in practice. You install a database driver that prints a connection banner on first use:

```
Connected to PostgreSQL 15.3 on localhost:5432
```

This line appears on stdout. The host tries to parse it as JSON-RPC:

```
Error: Unexpected token 'C' at position 0 in JSON
```

The connection drops. Your MCP server appears to crash randomly, but only on first use, and only when the database driver is loaded.

The fix is comprehensive and non-negotiable:

```typescript
// 1. Redirect all logging to stderr
import { createWriteStream } from "fs";
const logStream = createWriteStream("/dev/stderr", { flags: "a" });
const originalConsoleLog = console.log;
console.log = (...args) => {
  logStream.write(args.join(" ") + "\n");
};
console.warn = console.log;
console.info = console.log;
console.debug = console.log;
// console.error already goes to stderr in Node.js

// 2. Intercept process.stdout.write to catch rogue dependencies
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, encoding, callback) => {
  // Check if this looks like a JSON-RPC message
  const str = typeof chunk === "string" ? chunk : chunk.toString();
  if (str.startsWith("{") && str.includes('"jsonrpc"')) {
    return originalStdoutWrite(chunk, encoding, callback);
  }
  // Redirect everything else to stderr
  return process.stderr.write(chunk, encoding, callback);
};
```

This is aggressive, but necessary. The second technique — intercepting `process.stdout.write` — catches dependencies that bypass `console.log` and write directly to stdout. Popular culprits include database connection pools (pg, mysql2), HTTP clients (axios debug mode), and monitoring libraries (OpenTelemetry console exporter).

In Python, the equivalent fix:

```python
import sys
import io

# Redirect stdout to stderr before importing anything
real_stdout = sys.stdout
sys.stdout = sys.stderr

# Your MCP server writes to real_stdout via the transport
# Everything else goes to stderr

# Alternative: use the logging module exclusively
import logging
logging.basicConfig(stream=sys.stderr, level=logging.INFO)
logger = logging.getLogger("mcp-server")
```

The Python MCP SDK's `stdio_server` context manager handles this automatically — it captures stdout for protocol messages and redirects print statements to stderr. But any dependency that uses `os.write(1, ...)` directly will bypass this protection. Test by grepping your dependency tree for direct stdout writes.

### 4.6 Progressive Disclosure: From 134,000 Tokens to 20,000

A five-server MCP setup can consume the majority of a context window before the model reads a single user message. Anthropic reported internal configurations where tool definitions alone consumed 134,000 tokens out of a 200,000 token context window. This is not a theoretical concern — it is the default behavior when you connect multiple MCP servers to Claude Desktop or Cursor.

Here are real numbers from a production configuration:

| MCP Server | Tools | Avg Token Cost per Tool | Total Tokens |
|---|---|---|---|
| GitHub | 35 | ~740 | ~26,000 |
| Slack | 11 | ~1,900 | ~21,000 |
| Jira | 12 | ~1,400 | ~17,000 |
| Postgres | 8 | ~500 | ~4,000 |
| Sentry | 5 | ~600 | ~3,000 |
| Grafana | 5 | ~600 | ~3,000 |
| Deploy | 4 | ~750 | ~3,000 |
| **Total** | **80** | | **~77,000** |

That is 38% of a 200K context window consumed before the conversation starts. Add a system prompt (5,000-10,000 tokens) and the user's message with attached files (10,000-50,000 tokens), and you have very little room for the model to reason.

**Progressive disclosure** is the solution. Claude Code implements it with approximately 20 core tools always loaded, plus an Agent Skills system for extended capabilities, plus a Tool Search Tool for discovery. The implementation:

**Layer 1: Core tools (always loaded, ~5,000 tokens).** These are the tools the model needs on virtually every turn: Read, Write, Edit, Bash, Grep, Glob, Agent, TodoWrite.

**Layer 2: Agent Skills (~500 tokens for the skill index).** Extended capabilities stored as Markdown files in `.claude/agents/`. The model sees a list of skill names and descriptions. When it needs a skill, it reads the file and gains the instructions for that capability. This is progressive disclosure at the skill level — hundreds of capabilities, loaded one at a time.

**Layer 3: Tool Search Tool (~500 tokens).** For MCP-connected tools, the Tool Search Tool lets the model discover tools by semantic search instead of loading all definitions upfront.

The token savings are dramatic:

| Loading Strategy | Tokens at Start | Tokens on Demand | Total Savings |
|---|---|---|---|
| All tools upfront | 77,000 | 0 | 0% |
| Core + Search | 6,000 | ~2,000 per query | 85-92% |

Anthropic's Tool Search Tool (introduced November 2025) comes in two variants:

**Regex variant** (`tool_search_tool_regex_20251119`): The model constructs a Python regex pattern to search tool names and descriptions. Best for precise lookups when the model knows the tool name pattern.

**BM25 variant** (`tool_search_tool_bm25_20251119`): The model writes a natural language query. BM25 keyword matching returns relevant tools. Best for exploratory searches when the model knows what it wants to do but not what the tool is called.

The API configuration:

```json
{
  "tools": [
    {
      "type": "tool_search_tool_regex_20251119",
      "name": "tool_search"
    },
    {
      "type": "function",
      "function": {
        "name": "github_create_pr",
        "description": "Create a pull request on GitHub",
        "parameters": { ... }
      },
      "defer_loading": true
    },
    {
      "type": "function",
      "function": {
        "name": "slack_post_message",
        "description": "Post a message to a Slack channel",
        "parameters": { ... }
      },
      "defer_loading": true
    }
  ]
}
```

Tools marked with `defer_loading: true` are not included in the model's context. Only their names and descriptions are indexed for search. When the model searches for "github", it receives 3-5 matching `tool_reference` blocks with full schemas. Only those tools consume context.

The Tool Search Tool itself costs approximately 500 tokens — a constant overhead regardless of how many tools are registered. This makes it economical even with thousands of deferred tools.

### 4.7 Production MCP Server Checklist

Every MCP server going to production needs to handle these concerns. This is not theoretical hygiene — each item on this list has caused outages, data leaks, or corrupted agent behavior in real deployments.

#### Zod Validation on All Inputs

The MCP SDK validates inputs against your Zod schema before calling your handler. But your Zod schema must be comprehensive. Common mistakes:

```typescript
// BAD: accepts any string as a file path
{ path: z.string() }

// GOOD: validates path format and prevents directory traversal
{
  path: z
    .string()
    .regex(/^[a-zA-Z0-9_\-\/\.]+$/, "Path contains invalid characters")
    .refine(
      (p) => !p.includes(".."),
      "Path must not contain directory traversal sequences"
    )
    .refine(
      (p) => p.startsWith("/workspace/"),
      "Path must be within the workspace directory"
    )
}
```

#### Path Sandboxing

An MCP server that reads or writes files must enforce a sandbox. Without it, the model can read `/etc/shadow`, write to `/usr/bin`, or traverse into other users' directories:

```typescript
import { resolve, relative } from "path";

const SANDBOX_ROOT = resolve(process.env.WORKSPACE || "/workspace");

function sandboxPath(requestedPath: string): string {
  const resolved = resolve(SANDBOX_ROOT, requestedPath);
  const rel = relative(SANDBOX_ROOT, resolved);
  if (rel.startsWith("..") || resolve(SANDBOX_ROOT, rel) !== resolved) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Path '${requestedPath}' resolves outside sandbox root '${SANDBOX_ROOT}'`
    );
  }
  return resolved;
}
```

Claude Code implements path sandboxing by default — tools can only access files within the project directory unless the user explicitly grants broader access. Your custom MCP servers need the same protection.

#### Rate Limiting

An agent in a loop can call your MCP server hundreds of times per minute. If your server wraps an external API with rate limits, you need to enforce them proactively:

```typescript
import { RateLimiter } from "limiter";

const limiter = new RateLimiter({
  tokensPerInterval: 30,
  interval: "minute",
});

server.tool("search_issues", "...", { query: z.string() }, async ({ query }) => {
  const remaining = await limiter.removeTokens(1);
  if (remaining < 0) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text:
            "Rate limit reached (30 requests/minute). " +
            "Wait 60 seconds before retrying, or narrow your search query " +
            "to reduce the number of calls needed.",
        },
      ],
    };
  }
  // ... execute search
});
```

The error message tells the model both the limit and a strategy to stay within it. Without this guidance, the model will retry immediately and burn through its own retry budget.

#### Graceful Shutdown

When the host process terminates, your MCP server receives a SIGTERM (or the stdin pipe closes). You must clean up database connections, flush logs, and release locks:

```typescript
const cleanup = async () => {
  console.error("[MCP] Shutting down gracefully...");
  await db.end();
  await cache.disconnect();
  process.exit(0);
};

process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);

// Also handle stdin closing (host crashed or disconnected)
process.stdin.on("end", cleanup);
```

Without graceful shutdown, your server leaks database connections. Under pm2 or systemd (common in production), leaked connections accumulate until the database rejects new connections and the entire system goes down.

#### Session Isolation

If your MCP server maintains state (database connections, caches, in-memory data), that state must be isolated per session. Two concurrent conversations using the same MCP server must not interfere with each other:

```typescript
const sessions = new Map<string, SessionState>();

server.tool(
  "set_context",
  "Set the working context for this session.",
  {
    project: z.string(),
    environment: z.enum(["dev", "staging", "production"]),
  },
  async ({ project, environment }, { meta }) => {
    const sessionId = meta?.sessionId || "default";
    sessions.set(sessionId, { project, environment, startedAt: Date.now() });
    return {
      content: [
        {
          type: "text",
          text: `Context set to ${project} (${environment}) for session ${sessionId}`,
        },
      ],
    };
  }
);
```

The MCP protocol includes session identification in the `meta` field of tool calls. Use it. Without session isolation, one conversation's `set_context("payments", "production")` affects another conversation that was querying the staging environment.

#### Timeouts on External Calls

Every `fetch`, database query, or subprocess execution in your handler must have a timeout. An agent waiting indefinitely for a response consumes context window space (the pending tool call is in the model's context) and blocks the agent loop:

```typescript
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10_000); // 10s timeout

try {
  const res = await fetch(url, { signal: controller.signal });
  clearTimeout(timeout);
  // ...
} catch (err) {
  clearTimeout(timeout);
  if (err.name === "AbortError") {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Request timed out after 10 seconds. The service at ${url} may be down or slow. ` +
            `Try again in 30 seconds, or check service health first.`,
        },
      ],
    };
  }
  throw err;
}
```

Ten seconds is a reasonable default for API calls. Database queries should timeout at 30 seconds. Subprocess executions (build commands, test runs) may need 5-10 minutes. Match the timeout to the expected operation duration and always communicate the timeout to the model in the error message.

### 4.8 Remote MCP Servers: Streamable HTTP and OAuth 2.1

The stdio transport works for local servers — the host launches them as child processes. For shared infrastructure (a team's deployment server, a company's internal API gateway), you need remote MCP servers that run as HTTP services.

MCP's Streamable HTTP transport uses HTTP POST for client-to-server messages and Server-Sent Events (SSE) for server-to-client streaming. Authentication uses OAuth 2.1:

```typescript
import { StreamableHttpServerTransport } from "@modelcontextprotocol/sdk/server/streamablehttp.js";
import express from "express";

const app = express();

const transport = new StreamableHttpServerTransport({
  sessionIdGenerator: () => crypto.randomUUID(),
});

// OAuth 2.1 middleware (simplified)
app.use("/mcp", async (req, res, next) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    return res.status(401).json({
      error: "unauthorized",
      error_description: "Bearer token required",
    });
  }
  try {
    const claims = await verifyToken(token);
    req.user = claims;
    next();
  } catch {
    return res.status(401).json({
      error: "invalid_token",
      error_description: "Token expired or invalid",
    });
  }
});

app.post("/mcp", transport.handleRequest.bind(transport));
app.get("/mcp", transport.handleSse.bind(transport));

await server.connect(transport);
app.listen(3001);
```

The client configuration in Claude Desktop for a remote server:

```json
{
  "mcpServers": {
    "deployments": {
      "url": "https://mcp.internal.example.com/mcp",
      "transport": "streamable-http",
      "auth": {
        "type": "oauth2",
        "clientId": "claude-desktop",
        "authorizationUrl": "https://auth.example.com/authorize",
        "tokenUrl": "https://auth.example.com/token",
        "scopes": ["deployments:read", "deployments:write"]
      }
    }
  }
}
```

Remote servers have different failure modes than stdio servers. Network partitions, TLS certificate expiry, OAuth token refresh failures, and load balancer timeouts all need handling. The MCP SDK's `StreamableHttpServerTransport` handles reconnection and session resumption, but your application logic must be idempotent — the client may retry a request that the server already processed if the response was lost in transit.

---

## Chapter 5: Multi-Agent Orchestration — What Actually Works

### 5.1 The Math That Kills Multi-Agent

Before building a multi-agent system, do this calculation:

```
Single agent reliability: 99%
Two agents in sequence: 0.99 × 0.99 = 0.9801 (98%)
Three agents: 0.99³ = 0.9703 (97%)
Five agents: 0.99⁵ = 0.9510 (95.1%)
Ten agents: 0.99¹⁰ = 0.9044 (90.4%)
```

A 1% failure rate per agent becomes a 10% failure rate across ten agents. And 99% per-agent reliability is optimistic — real agents on real tasks with real tool calls fail at 3-10% per step, depending on the task complexity and tool reliability.

At 97% per-agent reliability:

```
Five agents: 0.97⁵ = 0.8587 (85.9%)
Ten agents: 0.97¹⁰ = 0.7374 (73.7%)
```

One in four runs fails with ten agents at 97% reliability. At 95%:

```
Five agents: 0.95⁵ = 0.7738 (77.4%)
Ten agents: 0.95¹⁰ = 0.5987 (59.9%)
```

Nearly half of all runs fail.

This is why Anthropic's consistent guidance is: **get each agent to 97%+ reliability before you chain them.** If a single agent cannot reliably complete its subtask, adding more agents makes the system worse, not better. The failure rate of the chain is always worse than the failure rate of its weakest link.

The practical implication: before building a multi-agent system, build each agent as a standalone system and measure its reliability on representative inputs. If any agent is below 97%, improve it first. Common improvements:

1. Better tool descriptions (section 4.3)
2. More specific system prompts with examples
3. Retries with exponential backoff for transient failures
4. Input validation that catches malformed requests before they reach the model
5. Fallback paths for known failure modes

Only after each agent individually exceeds 97% reliability should you compose them.

### 5.2 Context Drift: The Silent Killer

Context drift is the most insidious failure mode in multi-agent systems. It does not cause crashes. It does not trigger error handlers. It silently degrades output quality until the final result is wrong but plausible.

Here is how it happens. A user asks a five-agent pipeline to "analyze our Q4 sales data and recommend pricing changes for products that are underperforming in the European market."

Agent 1 (data extraction) correctly queries Q4 sales data for European markets.

Agent 2 (analysis) receives Agent 1's output. It identifies underperforming products. But it interprets "underperforming" as "below average revenue" rather than "below target revenue." This is a subtle reinterpretation — both are reasonable definitions, but the user meant "below target."

Agent 3 (pricing) receives Agent 2's analysis. It does not question the definition of "underperforming." It designs pricing changes for products that are below average revenue. Some of these products are actually meeting their targets.

Agent 4 (risk assessment) evaluates the pricing changes. It finds them reasonable because the input data looks correct — it is correct, just for the wrong set of products.

Agent 5 (report generation) produces a confident, well-formatted report recommending price reductions for products that do not need them.

The original intent — "products below target in Europe" — was silently reinterpreted to "products below average globally" by agent 2, and every subsequent agent treated that reinterpretation as ground truth.

**Fix: Shared state with write-once immutable intent.**

Define the user's intent as a structured, immutable object that every agent reads but no agent modifies:

```python
from pydantic import BaseModel, Field
from typing import Literal
from datetime import date

class TaskIntent(BaseModel):
    """Immutable intent object. Created once at task start.
    Every agent reads this. No agent modifies it."""

    objective: str = Field(
        description="The user's objective in their exact words"
    )
    scope_region: str = Field(
        description="Geographic scope, e.g. 'Europe', 'North America'"
    )
    scope_time: str = Field(
        description="Time period, e.g. 'Q4 2025', '2025-10 to 2025-12'"
    )
    metric: str = Field(
        description="The specific metric to evaluate against, e.g. "
        "'revenue vs target', 'units sold vs forecast'"
    )
    threshold_definition: str = Field(
        description="Exact definition of the threshold, e.g. "
        "'below 90% of quarterly target'"
    )
    created_at: date = Field(default_factory=date.today)
    created_by: str = Field(description="ID of the agent or user that created this intent")

    class Config:
        frozen = True  # Immutable after creation

class AgentOutput(BaseModel):
    """Every agent writes its output here with explicit reference to intent."""

    agent_id: str
    intent_hash: str = Field(
        description="SHA256 of the TaskIntent, proving this output "
        "was produced against the original intent"
    )
    interpretation: str = Field(
        description="This agent's interpretation of its subtask, "
        "written in plain language for downstream agents to verify"
    )
    output_data: dict
    confidence: float = Field(ge=0.0, le=1.0)
    assumptions: list[str] = Field(
        default_factory=list,
        description="Any assumptions this agent made that were not "
        "explicit in the intent"
    )
```

The `TaskIntent` is frozen (immutable after creation). Every agent reads it before starting its work. Every agent writes its `interpretation` field, explaining how it understood its subtask. Every agent includes `assumptions` — explicit statements about what it inferred that was not in the intent.

The `intent_hash` field is the key mechanism. Every agent computes a hash of the `TaskIntent` and includes it in its output. If the intent is accidentally modified (a bug in the orchestrator, a serialization error), the hash mismatch is detectable.

Downstream agents read their predecessor's `interpretation` and `assumptions` fields. If agent 3 reads agent 2's interpretation — "I defined 'underperforming' as below average revenue" — and it contradicts the intent's `threshold_definition` — "below 90% of quarterly target" — agent 3 can flag the discrepancy instead of silently propagating it.

### 5.3 Race Conditions in Multi-Agent Systems

Race conditions occur when agents execute concurrently and make decisions based on incomplete information from other agents.

Consider a travel-booking multi-agent system:

```
Agent A (Inquiry):    Collecting user preferences for a trip
Agent B (Scheduling): Booking calendar slots for meetings
Agent C (Flights):    Searching and booking flights
Agent D (Hotels):     Searching and booking hotels
```

Agent B starts booking meetings before Agent A finishes collecting all requirements. Agent B books a 9 AM Monday meeting in London. Agent A then discovers the user cannot travel until Tuesday. Agent C has already purchased a non-refundable flight arriving Monday evening based on Agent B's calendar. The system has committed resources based on incomplete information.

**Fix: Event Spine with ordered event streams.**

An Event Spine is a centralized, ordered log of events that all agents publish to and subscribe from. No agent acts on stale state — every agent reads the latest events before making decisions.

```python
import asyncio
from dataclasses import dataclass, field
from typing import Any
from datetime import datetime
import json

@dataclass
class Event:
    source_agent: str
    event_type: str
    data: dict[str, Any]
    timestamp: datetime = field(default_factory=datetime.utcnow)
    sequence_number: int = 0
    context_id: str = ""  # Links events to a specific task/conversation

    def to_dict(self) -> dict:
        return {
            "source": self.source_agent,
            "type": self.event_type,
            "data": self.data,
            "timestamp": self.timestamp.isoformat(),
            "seq": self.sequence_number,
            "context_id": self.context_id,
        }


class EventSpine:
    """Ordered event log with subscription-based delivery.
    All agents publish events here. All agents read from here.
    Events are strictly ordered by sequence number."""

    def __init__(self):
        self._events: list[Event] = []
        self._sequence = 0
        self._subscribers: dict[str, asyncio.Queue] = {}
        self._lock = asyncio.Lock()

    async def publish(self, event: Event) -> int:
        async with self._lock:
            self._sequence += 1
            event.sequence_number = self._sequence
            self._events.append(event)
            for queue in self._subscribers.values():
                await queue.put(event)
            return self._sequence

    def subscribe(self, agent_id: str) -> asyncio.Queue:
        queue = asyncio.Queue()
        self._subscribers[agent_id] = queue
        return queue

    def get_events_since(self, sequence: int) -> list[Event]:
        return [e for e in self._events if e.sequence_number > sequence]

    def get_events_by_type(self, event_type: str) -> list[Event]:
        return [e for e in self._events if e.event_type == event_type]


class SpineAwareAgent:
    """Base class for agents that coordinate through the Event Spine."""

    def __init__(self, agent_id: str, spine: EventSpine):
        self.agent_id = agent_id
        self.spine = spine
        self.last_seen_sequence = 0
        self._event_queue = spine.subscribe(agent_id)

    async def wait_for_event(self, event_type: str, timeout: float = 30.0) -> Event | None:
        """Block until a specific event type appears, or timeout."""
        deadline = asyncio.get_event_loop().time() + timeout
        while asyncio.get_event_loop().time() < deadline:
            try:
                remaining = deadline - asyncio.get_event_loop().time()
                event = await asyncio.wait_for(
                    self._event_queue.get(), timeout=max(0.1, remaining)
                )
                self.last_seen_sequence = event.sequence_number
                if event.event_type == event_type:
                    return event
            except asyncio.TimeoutError:
                continue
        return None

    async def publish(self, event_type: str, data: dict) -> int:
        event = Event(
            source_agent=self.agent_id,
            event_type=event_type,
            data=data,
        )
        return await self.spine.publish(event)

    def check_prerequisites(self, required_events: list[str]) -> list[str]:
        """Check which prerequisite events have NOT been published yet."""
        published_types = {e.event_type for e in self.spine._events}
        return [req for req in required_events if req not in published_types]
```

The scheduling agent now waits for the inquiry agent to publish a `requirements_complete` event before booking anything:

```python
class SchedulingAgent(SpineAwareAgent):
    async def run(self):
        # Wait for requirements to be finalized
        missing = self.check_prerequisites(["requirements_complete"])
        if missing:
            req_event = await self.wait_for_event("requirements_complete", timeout=120)
            if req_event is None:
                await self.publish("scheduling_error", {
                    "reason": "Timed out waiting for requirements",
                })
                return

        requirements = req_event.data
        travel_dates = requirements["travel_dates"]
        # Now safe to book — we have confirmed travel dates
        await self.book_meetings(travel_dates)
        await self.publish("meetings_booked", {
            "meetings": self.booked_meetings,
            "travel_dates": travel_dates,
        })
```

The Event Spine imposes ordering constraints without requiring agents to know about each other. The scheduling agent does not import the inquiry agent or call its methods — it subscribes to an event type. This decoupling means you can add, remove, or replace agents without modifying the others.

### 5.4 Cascade Failures and Inter-Agent Validation

A cascade failure occurs when one agent produces marginally incorrect output, and subsequent agents treat it as ground truth, amplifying the error at each stage.

Agent A extracts data from a PDF and misreads "$1.2M" as "$12M" due to a formatting artifact. Agent B builds a financial model using the $12M figure. Agent C generates investment recommendations based on that model. The recommendations are wrong by an order of magnitude, but every intermediate step looks internally consistent.

This is different from context drift (section 5.2). Context drift changes the interpretation of the task. Cascade failures corrupt the data while keeping the interpretation correct. The task definition is fine — "analyze revenue" — but the revenue number is wrong.

**Fix: Inter-agent validation with sampled contracts.**

Define explicit contracts between agents. A contract specifies what the output of one agent should look like, and downstream agents validate against it before proceeding:

```python
from pydantic import BaseModel, validator
from typing import Optional

class DataExtractionContract(BaseModel):
    """Contract for data extraction agent output.
    Downstream agents validate against this before using the data."""

    source_document: str
    extraction_method: str  # "ocr", "text_parse", "table_extract"
    confidence_score: float
    revenue_figures: list[dict]

    @validator("confidence_score")
    def confidence_must_be_reasonable(cls, v):
        if v < 0.7:
            raise ValueError(
                f"Confidence score {v} is below threshold 0.7. "
                f"Data extraction may be unreliable."
            )
        return v

    @validator("revenue_figures")
    def revenues_must_be_sane(cls, v):
        for fig in v:
            amount = fig.get("amount", 0)
            if amount > 1e12:
                raise ValueError(
                    f"Revenue figure ${amount:,.0f} exceeds sanity check "
                    f"threshold of $1T. Likely an extraction error."
                )
            if amount < 0:
                raise ValueError(
                    f"Negative revenue ${amount:,.0f} is likely an error."
                )
        return v


class ContractValidator:
    """Validates agent outputs against inter-agent contracts.
    Uses sampling for expensive validations."""

    def __init__(self, sample_rate: float = 0.1):
        self.sample_rate = sample_rate
        self.validation_log: list[dict] = []

    def validate(self, output: dict, contract_class: type[BaseModel]) -> tuple[bool, Optional[str]]:
        """Validate an agent's output against a contract.

        Returns (is_valid, error_message).
        """
        try:
            contract_class(**output)
            self.validation_log.append({
                "contract": contract_class.__name__,
                "valid": True,
                "sampled": True,
            })
            return True, None
        except Exception as e:
            self.validation_log.append({
                "contract": contract_class.__name__,
                "valid": False,
                "error": str(e),
                "sampled": True,
            })
            return False, str(e)
```

Contracts catch two categories of errors:

1. **Structural errors**: missing fields, wrong types, unexpected formats. Pydantic catches these automatically.
2. **Semantic errors**: values that are technically valid but obviously wrong. The `revenues_must_be_sane` validator catches order-of-magnitude extraction errors.

For expensive validations (e.g., calling another model to verify the extracted data against the source document), use sampling: validate 10% of outputs at full depth, validate all outputs at the structural level. The `sample_rate` parameter controls this tradeoff.

### 5.5 The 79% Statistic: Most Failures Are Not Model Failures

The MAST (Multi-Agent System Testing) research framework found that **79% of multi-agent system failures are specification and coordination failures, not model failures.** The model did its job correctly — it followed the instructions it was given. The instructions were wrong, incomplete, or contradictory.

The failure categories:

| Category | % of Failures | Example |
|---|---|---|
| Ambiguous task specification | 34% | "Process the data" — which data? Which processing? |
| Missing coordination constraints | 22% | Two agents modify the same resource concurrently |
| Incorrect delegation boundaries | 13% | Agent A is given work that requires Agent B's tools |
| Schema mismatches between agents | 10% | Agent A outputs `{ "total": 42 }`, Agent B expects `{ "sum": 42 }` |
| Model reasoning errors | 21% | Model misunderstands a clear instruction |

The implication: **you will get more reliability improvement from better specifications and coordination than from better models.** Upgrading from GPT-4 to GPT-4.5 improves the 21% model failure category. Fixing your specifications and coordination fixes the 79%.

Concrete actions based on this data:

1. **Write task specifications in structured formats**, not natural language. Use Pydantic models, JSON schemas, or typed interfaces. "Process the data" becomes a `ProcessingTask` object with explicit `input_schema`, `output_schema`, `constraints`, and `validation_rules`.

2. **Define coordination constraints explicitly.** Which agents can run concurrently? Which must be sequential? What shared resources exist? Use the Event Spine pattern (section 5.3) or explicit dependency declarations.

3. **Test agent boundaries independently.** Before composing agents, verify that each agent's input/output schemas match what its neighbors produce/expect. Schema mismatches are trivially detectable with type checking but frequently missed in dynamic systems.

### 5.6 OpenAI Codex Subagents in Practice

OpenAI Codex (GA March 2026) implements multi-agent through a configuration file at `.codex/config.toml`:

```toml
# .codex/config.toml — Production configuration

model = "o4-mini"

# Agent concurrency settings
[agents]
max_threads = 6
max_depth = 1
job_max_runtime_seconds = 1800

# Custom agent: PR Explorer
[agents.pr_explorer]
description = "Read-only codebase explorer. Maps dependencies, traces call graphs, builds context for workers."
config_file = "agents/pr_explorer.toml"

# Custom agent: Security Reviewer
[agents.security_reviewer]
description = "Reviews code changes for security vulnerabilities, auth bypasses, and data exposure risks."
config_file = "agents/security_reviewer.toml"

# Custom agent: Test Writer
[agents.test_writer]
description = "Generates unit and integration tests for changed code. Runs tests to verify coverage."
config_file = "agents/test_writer.toml"
```

Each custom agent gets its own TOML file:

```toml
# agents/pr_explorer.toml
role = "explorer"
model = "o4-mini"

[system_prompt]
content = """You are a codebase explorer. Your job is to:
1. Map the dependency graph of the changed files
2. Trace the call graph from changed functions to their callers
3. Identify all test files that cover the changed code
4. Build a context summary for worker agents

Output format:
- Changed files with line ranges
- Direct dependencies (imports/requires)
- Reverse dependencies (who imports these files)
- Related test files
- Risk assessment: HIGH/MEDIUM/LOW for each changed file

Do NOT modify any files. Read-only access only."""
```

The three built-in roles have different permissions:

| Role | File Access | Shell Access | Purpose |
|---|---|---|---|
| `default` | Read/Write | Yes | General-purpose operations |
| `worker` | Read/Write | Yes | Focused implementation tasks |
| `explorer` | Read-only | No | Safe codebase scanning |

The `explorer` role is the most important for multi-agent reliability. Before workers make changes, an explorer maps the codebase. Workers receive the explorer's context map and scope their edits accordingly. This prevents a common failure: a worker agent modifying a file based on incomplete understanding of its dependencies, breaking code it never read.

**The `spawn_agents_on_csv` feature** is experimental but powerful for batch operations:

```python
# spawn_agents_on_csv usage (from Codex manager agent)
# Each CSV row becomes a separate worker agent

# Input: review_tasks.csv
# file,task,context
# src/auth.ts,security review,"Authentication module, handles JWT tokens"
# src/db.ts,security review,"Database layer, raw SQL queries"
# src/api.ts,security review,"REST API handlers, processes user input"

# The manager agent invokes:
spawn_agents_on_csv("review_tasks.csv", agent="security_reviewer", max_concurrent=3)

# Output: review_results.csv
# file,task,status,findings
# src/auth.ts,security review,done,"[{severity: HIGH, issue: 'JWT not validated on /admin/*'}]"
# src/db.ts,security review,done,"[{severity: CRITICAL, issue: 'SQL injection in search()'}]"
# src/api.ts,security review,error,"Timeout after 1800s"
```

Each CSV row spawns an independent worker agent. Workers run concurrently up to `max_threads` (6 in the config above). Results are collected back into a CSV. The manager agent reads the results CSV and synthesizes a report.

The `max_depth = 1` constraint is deliberate. Codex does not allow workers to spawn sub-workers. Anthropic and OpenAI arrived at the same constraint independently — depth-1 is the sweet spot where delegation is useful but the system remains predictable.

### 5.7 Claude Code Subagents: Clean Context Through Depth-1 Delegation

Claude Code's subagent model solves a specific problem: **the main agent's context fills up with intermediate work (file reads, grep results, test output) that is needed for one step but irrelevant to subsequent steps.**

Without subagents, reading 20 files to understand an authentication module consumes 40,000+ tokens of context. Those tokens are permanent — they stay in the context for the rest of the conversation, displacing space that could be used for actual implementation work.

With subagents, the exploration happens in a separate 200K token context. Only the summary (200-500 tokens) returns to the parent:

```
Parent agent context:
  [User message: "Fix the login bug where OAuth tokens expire prematurely"]
  [Subagent result: "The OAuth token handling is in src/auth/oauth.ts.
   Tokens are created with a 1-hour expiry in createToken() at line 47.
   The refresh logic in refreshToken() at line 92 has a bug: it checks
   Date.now() > token.expiresAt but expiresAt is stored in seconds
   while Date.now() returns milliseconds. Tokens appear expired
   immediately after creation. Fix: change the comparison to
   Date.now() / 1000 > token.expiresAt"]
  [Agent reads src/auth/oauth.ts line 92]
  [Agent edits the comparison]
```

The parent never saw the 20 files the subagent read. It got a focused summary with the exact file, line number, and diagnosis. Total context cost: ~500 tokens instead of ~40,000.

**The `parent_tool_use_id` tracking mechanism** links subagent outputs back to the tool call that spawned them. This is how the parent agent knows which subagent result corresponds to which delegation:

```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_01ABC...",
  "content": [
    {
      "type": "text",
      "text": "Subagent summary: The OAuth token handling is in..."
    }
  ]
}
```

The `tool_use_id` matches the original `Agent(...)` tool call. When the parent spawns three subagents in parallel, it can match results to requests without ambiguity.

**Clean context per subagent** means each subagent starts with:
1. The parent's system prompt (inherited)
2. The specific task description (from the `Agent()` call)
3. Nothing else — no conversation history, no previous tool results

This is intentional. The subagent does not need to know what the parent discussed five turns ago. It needs to know exactly what to do right now. Clean context prevents the subagent from being distracted by irrelevant prior conversation.

The built-in subagent types optimize for different cost/capability tradeoffs:

| Type | Model | Tools | Cost | Use Case |
|---|---|---|---|---|
| Explore | Haiku | Read, Grep, Glob | Low | File discovery, code search |
| Plan | Inherited | Read, Grep, Glob | Medium | Architectural analysis |
| General | Inherited | All | Medium | Terminal commands, edits |
| Guide | Haiku | None | Lowest | Answering questions about Claude Code |

Explore agents use Haiku (the smallest, cheapest Claude model) because file reading does not require sophisticated reasoning. Plan agents inherit the parent's model because architectural analysis requires the full reasoning capability. General agents have all tools because they may need to run builds, execute tests, or make edits.

Custom subagents are defined as Markdown files with YAML frontmatter:

```markdown
---
name: db-migration-checker
description: "Validates database migrations for safety. Checks for irreversible operations, missing rollback scripts, and data loss risks."
model: sonnet
tools: ["Read", "Grep", "Glob", "Bash"]
permissionMode: plan
---

You are a database migration safety reviewer. For each migration file:

1. Check for irreversible operations (DROP TABLE, DROP COLUMN, TRUNCATE)
2. Verify a corresponding rollback migration exists
3. Check for data loss risks (column type changes that truncate data)
4. Verify the migration is idempotent (can be run twice without error)
5. Check for lock contention (ALTER TABLE on large tables without CONCURRENTLY)

Output format:
SAFE: Migration can be applied without risk
WARNING: Migration has risks that should be reviewed (list them)
BLOCK: Migration must not be applied (explain why)

For WARNING and BLOCK, include the specific SQL statement and line number.
```

Place this at `.claude/agents/db-migration-checker.md`. Invoke it with `@"db-migration-checker" check the pending migrations`.

### 5.8 When NOT to Use Multi-Agent

Anthropic's production experience and research systems converge on a clear principle: **most tasks do not benefit from multi-agent orchestration.** From their multi-agent research system documentation:

> "Most coding tasks involve fewer truly parallelizable tasks than research. For coding, you often need sequential steps: understand the codebase, plan the change, implement, test. Research tasks can parallelize better: search multiple sources simultaneously, analyze from multiple angles. Even then, coordination overhead can negate the parallelism benefit."

The Anthropic team learned this the hard way with their early multi-agent research system:

> "Early agents made errors like spawning 50 subagents for simple queries. We had to embed explicit scaling rules into the prompts: simple fact-finding requires 1 agent with 3-10 tool calls; direct comparisons might need 2-3 agents; comprehensive research might need 5+."

Here is the decision framework that reflects production experience:

**Use a single agent when:**
- The task fits in one context window (under 100K tokens of work)
- Steps are sequential and dependent (each step uses the previous step's output)
- The task requires consistent reasoning about a single artifact (code review, bug analysis)
- Error recovery requires understanding the full context of what went wrong

**Use multi-agent when:**
- The task requires more context than one window can hold (large codebase refactoring)
- Subtasks are genuinely independent (reviewing different files in parallel)
- Different subtasks need different capabilities (read-only analysis vs. write access)
- Verification quality matters (separate generator and evaluator contexts)
- The task involves batch processing (same operation on many inputs)

**Never use multi-agent when:**
- You are trying to improve quality through "collaboration" (agents agreeing with each other is not verification — it is echo-chambering)
- The coordination overhead exceeds the parallelism benefit (two agents spending 3,000 tokens each on coordination to save 2,000 tokens of serial execution)
- Agent boundaries are arbitrary (splitting a task into "Plan Agent" and "Execute Agent" when one agent can plan and execute perfectly well)

The overhead budget for multi-agent is non-trivial:

| Overhead Source | Token Cost | Latency Cost |
|---|---|---|
| Orchestrator reasoning (per delegation) | 500-2,000 | 2-5 seconds |
| Context duplication (background per agent) | 2,000-10,000 | 0 (parallel) |
| Result synthesis (per agent response) | 500-1,500 | 2-5 seconds |
| Error handling / retry (per failure) | 1,000-5,000 | 5-30 seconds |

A five-agent system with two retries consumes 15,000-50,000 tokens in coordination overhead alone. If the serial single-agent approach costs 30,000 tokens total, the multi-agent version may cost 60,000-100,000 tokens for marginal quality improvement.

---

## Chapter 6: Long-Horizon Agent Harnesses — The Initializer Pattern

### 6.1 The Initializer Creates Three Files

Anthropic's "Effective Harnesses for Long-Running Agents" (2025) documented a pattern that became the foundation for every production long-horizon coding agent. The pattern has two phases: an initializer agent that runs once, and a coding agent that runs repeatedly. The initializer creates three artifacts that the coding agent reads on every session.

**Artifact 1: `init.sh`** — A script that sets up and starts the development environment.

```bash
#!/bin/bash
# init.sh — Autonomous agent development environment setup
# This script is run by the coding agent at the start of every session.
# It must be idempotent (safe to run multiple times).

set -e

echo "[init.sh] Installing dependencies..."
npm install 2>&1 | tail -5

echo "[init.sh] Starting dev server in background..."
if lsof -i :3000 > /dev/null 2>&1; then
    echo "[init.sh] Dev server already running on port 3000"
else
    npm run dev > /tmp/dev-server.log 2>&1 &
    DEV_PID=$!
    echo "[init.sh] Dev server PID: $DEV_PID"

    # Wait for server to be ready (max 30 seconds)
    for i in $(seq 1 30); do
        if curl -s http://localhost:3000 > /dev/null 2>&1; then
            echo "[init.sh] Dev server ready at http://localhost:3000"
            break
        fi
        if [ "$i" = "30" ]; then
            echo "[init.sh] ERROR: Dev server did not start within 30 seconds"
            cat /tmp/dev-server.log
            exit 1
        fi
        sleep 1
    done
fi

echo "[init.sh] Starting database..."
if ! pg_isready -q 2>/dev/null; then
    pg_ctl start -D /var/lib/postgresql/data -l /tmp/pg.log
    sleep 2
fi

echo "[init.sh] Running migrations..."
npx prisma migrate deploy 2>&1 | tail -3

echo "[init.sh] Environment ready."
```

The key design decisions:

- **Idempotent**: checks if services are already running before starting them. The coding agent may run `init.sh` multiple times in a session (after a context reset, after a crash, to verify the environment).
- **Quiet output**: pipes verbose output through `tail -5` to keep the agent's context clean. The agent does not need to see 200 lines of npm install output.
- **Error reporting**: if the dev server does not start, the script dumps the server log and exits with a non-zero code. The coding agent sees the error and can diagnose it.
- **Background processes**: the dev server runs in the background (`&`) so the script returns and the agent can continue working.

**Artifact 2: `claude-progress.txt`** — A structured progress log.

```
# Claude Progress Log
# Format: Each session gets a dated entry with completed work and next priorities.
# Rules: Only append. Never delete or modify previous entries.

## Session 1 (Initializer) — 2025-11-15T09:00:00Z
- Created project structure (Next.js 14 + Prisma + PostgreSQL)
- Created feature_list.json with 147 testable features
- Created init.sh for development environment
- Initialized git repository
- Implemented project skeleton:
  - Layout component with navigation
  - Home page with placeholder content
  - Database schema for users table
- 3/147 features passing
- Commit: a1b2c3d "Initial project setup"

## Next Session Priorities:
1. Authentication system (features 4-12)
2. User profile page (features 13-18)
3. Fix: navigation links not active on current page

## Known Issues:
- Tailwind dark mode not configured (needed for features 89-95)
- No test infrastructure yet (needed before feature 50)
```

The format matters:

- **Dated session headers** with timestamps. The coding agent can calculate how much work was done per session and estimate remaining effort.
- **Specific commit hashes**. The coding agent can run `git diff a1b2c3d..HEAD` to see exactly what changed since the last session.
- **Feature count progress** (`3/147 features passing`). This is the single most important metric. If the number goes down, the agent has introduced a regression and must fix it before continuing.
- **Next session priorities** at the end. The coding agent reads this first and starts immediately on the highest-priority item.
- **Known issues** section. Problems discovered but not fixed get tracked here so they are not forgotten across context boundaries.

**Artifact 3: `feature_list.json`** — A comprehensive, testable feature specification.

```json
{
  "project": "Task Management App",
  "total_features": 147,
  "features": [
    {
      "id": 1,
      "name": "Home page renders",
      "category": "core",
      "priority": 1,
      "passes": true,
      "testing_steps": [
        "Navigate to http://localhost:3000/",
        "Verify the page loads without errors",
        "Verify the navigation bar is visible",
        "Verify the main content area displays"
      ],
      "last_tested": "2025-11-15T09:30:00Z",
      "tested_by": "initializer"
    },
    {
      "id": 4,
      "name": "User can sign up with email and password",
      "category": "authentication",
      "priority": 2,
      "passes": false,
      "testing_steps": [
        "Navigate to http://localhost:3000/signup",
        "Enter email 'test@example.com' in the email field",
        "Enter password 'TestPassword123!' in the password field",
        "Click the 'Sign Up' button",
        "Verify redirect to /dashboard",
        "Verify welcome message 'Welcome, test@example.com' is visible",
        "Verify a new user record exists in the database"
      ],
      "last_tested": null,
      "tested_by": null
    },
    {
      "id": 5,
      "name": "User can log in with existing credentials",
      "category": "authentication",
      "priority": 2,
      "passes": false,
      "testing_steps": [
        "Ensure test user exists (run feature 4 first)",
        "Navigate to http://localhost:3000/login",
        "Enter email 'test@example.com'",
        "Enter password 'TestPassword123!'",
        "Click 'Log In'",
        "Verify redirect to /dashboard",
        "Verify user name is displayed in the header"
      ],
      "last_tested": null,
      "tested_by": null
    }
  ]
}
```

Critical design rules for the feature list:

1. **Features can only transition from `false` to `true`.** They can never be removed, reworded, or reordered. This prevents the agent from silently dropping hard features.
2. **Testing steps are concrete and automatable.** "Verify the page loads" is too vague. "Verify the navigation bar is visible" is specific. "Verify a new user record exists in the database" is testable with a SQL query.
3. **Dependencies between features are implicit in priority ordering.** Feature 5 (login) depends on feature 4 (signup). The priority field ensures the agent works on feature 4 first.
4. **The `last_tested` and `tested_by` fields** create an audit trail. If a feature was last tested three sessions ago, it may need re-verification.

### 6.2 The Coding Agent Orientation Sequence

Every coding session follows an exact startup sequence. The sequence is embedded in the coding agent's system prompt, and the agent executes it before doing any implementation work:

```
Step 1: pwd
  → Confirms the working directory is correct.
  → If wrong, navigate to the project root.

Step 2: cat claude-progress.txt
  → Read the progress log to understand:
     - What was done in previous sessions
     - What priorities were set for this session
     - What known issues exist

Step 3: cat feature_list.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'{sum(1 for f in d[\"features\"] if f[\"passes\"])}/{d[\"total_features\"]} features passing')"
  → Quick progress check. If the count decreased since last session,
    a regression was introduced.

Step 4: git log --oneline -20
  → Read recent commits to understand what changed and when.
  → Look for commits from other agents or human developers.

Step 5: ./init.sh
  → Start the development environment.
  → If init.sh fails, diagnose and fix before proceeding.

Step 6: Smoke test
  → Run a basic end-to-end test to verify the app works.
  → For web apps: curl http://localhost:3000 + Puppeteer MCP navigation
  → For CLI tools: run the main command with --help
  → For APIs: hit the health check endpoint

Step 7: Check for regressions
  → If the smoke test fails, stop and fix the regression.
  → Do NOT implement new features on top of a broken app.

Step 8: Pick the highest-priority incomplete feature
  → Read feature_list.json, filter for passes: false,
    sort by priority, take the first one.

Step 9: Implement the feature
  → Write code, run tests, verify manually.

Step 10: Test the feature against its testing_steps
  → Execute each step from feature_list.json.
  → All steps must pass.

Step 11: Update feature_list.json
  → Set passes: true, last_tested: now, tested_by: "coding-agent"

Step 12: Commit
  → git add -A && git commit -m "feat: [feature name] (feature #N)"

Step 13: Update claude-progress.txt
  → Append session entry with completed work and next priorities.
```

The "fix before build" discipline in steps 6-7 is the single most important principle. Without it, agents accumulate technical debt across sessions. Each new feature is built on top of untested assumptions from the previous session. By session 5, the app is a house of cards.

Here is the actual claude-progress.txt format with timestamps and commit hashes as used in production:

```
## Session 4 — 2025-11-16T14:22:00Z
- Started: 45/147 features passing
- Ran init.sh: dev server started on port 3000
- Smoke test: PASSED (homepage loads, auth works, dashboard renders)
- Regression check: NONE detected
- Implemented:
  - Feature #46: Task creation form validates required fields
    - Added Zod validation to task creation API route
    - Added client-side validation to TaskForm component
    - Commit: f8e2a1b "feat: task creation form validation (feature #46)"
  - Feature #47: Task list displays all user tasks
    - Added /api/tasks GET endpoint with pagination
    - Added TaskList component with infinite scroll
    - Commit: 3c9d4e5 "feat: task list with pagination (feature #47)"
  - Feature #48: User can mark task as complete
    - Added PATCH /api/tasks/:id endpoint
    - Added checkbox toggle in TaskList component
    - Fixed: checkbox did not update optimistically (added useSWR mutate)
    - Commit: 7a1b2c3 "feat: task completion toggle (feature #48)"
- Ended: 48/147 features passing
- Session duration: ~45 minutes (estimated from commit timestamps)

## Next Session Priorities:
1. Feature #49: Task due dates with date picker
2. Feature #50: Overdue tasks highlighted in red
3. Feature #51: Task filtering by status (all/active/completed)

## Known Issues:
- Tailwind dark mode not configured (needed for features 89-95)
- Test infrastructure needed before feature 60 (API integration tests)
- TaskList infinite scroll has a flicker on slow connections (cosmetic)
```

### 6.3 The Four Failure Modes and Their Fixes

Anthropic documented these failure modes from extensive experimentation with long-running agents. Each failure mode has a specific cause, a specific symptom, and a specific structural fix.

| # | Failure Mode | Symptom | Root Cause | Fix | Mechanism |
|---|---|---|---|---|---|
| 1 | Agent tries to do too much | Quality degrades, code becomes buggy, tests are skipped | Agent attempts 10+ features in one session | Feature list + one feature per session | `feature_list.json` decomposes work; agent picks ONE feature |
| 2 | Agent declares victory early | Core happy paths work, edge cases and error handling missing | Agent self-evaluates ("looks done to me") | Verification against feature list | Agent cannot mark done without passing ALL testing_steps |
| 3 | Agent loses state | Re-implements existing features, introduces regressions, starts from scratch | New context window has no memory of prior sessions | Progress files + structured artifacts | `claude-progress.txt` + `feature_list.json` + `git log` |
| 4 | Agent cannot test its work | Marks features as done based on code review alone, missing runtime bugs | No way to run the app and verify behavior | `init.sh` + end-to-end testing | Script starts dev environment; Puppeteer/Playwright MCP enables browser testing |

**Failure mode 1** is the most common. The agent reads the feature list, sees 100 remaining features, and tries to batch them. This is especially prevalent with larger models that have more context capacity — they attempt more, but quality degrades as the context fills. The fix is prompt-level: "Pick ONE feature. Implement it. Test it. Commit it. Then update progress. Do not start a second feature until the first is complete and committed."

**Failure mode 2** is the most dangerous. The agent implements the happy path for user authentication — signup and login work. It marks the feature as done. But the testing steps include "Verify error message when email is already registered" and "Verify error message when password is too short." The agent did not test these. The fix is structural: the feature cannot be marked as `passes: true` until every testing step has been executed and verified. The testing steps are the acceptance criteria, not the agent's judgment.

**Failure mode 3** occurs at context boundaries. The agent's 200K token context is consumed. A new session starts. Without `claude-progress.txt`, the agent has no memory. It reads the codebase, forms its own understanding of the project state (which may be wrong), and starts implementing features that already work. The fix costs approximately 2,000 tokens per session (reading the three artifacts) and provides complete situational awareness.

**Failure mode 4** creates silent quality degradation. The agent writes a form component, eyeballs the code, decides it looks correct, and moves on. The form has a bug: the submit button does not disable during submission, allowing double-submits. The agent would have caught this if it could click the button. The fix is `init.sh` (which starts the dev server) combined with browser automation (Puppeteer MCP or Playwright MCP). The agent navigates to the form, fills it out, clicks submit, and verifies the behavior in a real browser.

### 6.4 Production Example: "Koda" — An Agent Running 24/7

"Koda" is a production agent system running continuously under pm2 (a Node.js process manager). It handles 21 scheduled tasks across 11 MCP servers with 43 helper scripts and 18 learned skills. This is not a demo — it is a real system running in a real company.

The architecture follows what the operators call "thin runtime + fat filesystem":

```
~/koda/
├── soul.md              # Identity: who this agent is, what it values,
│                        # how it communicates. Never modified by the agent.
├── learnings.md         # Accumulated lessons. The agent appends here
│                        # after every significant experience.
├── goals.md             # Current objectives. Updated weekly by humans,
│                        # read daily by the agent.
├── tasks.json           # Active task queue with priorities, deadlines,
│                        # and dependencies.
├── skills/              # 18 skill files — step-by-step procedures
│   ├── deploy.md        # How to deploy a service
│   ├── incident.md      # How to respond to an incident
│   ├── self-heal.md     # How to diagnose and fix its own failures
│   ├── code-review.md   # How to review a PR
│   ├── standup.md       # How to generate a daily standup summary
│   └── ...
├── scripts/             # 43 helper scripts the agent can invoke
│   ├── check-health.sh  # Service health checks
│   ├── run-tests.sh     # Test suite execution
│   ├── deploy.sh        # Deployment pipeline
│   ├── rollback.sh      # Emergency rollback
│   └── ...
├── mcp-servers/         # 11 MCP server configurations
│   ├── github.json
│   ├── slack.json
│   ├── jira.json
│   ├── postgres.json
│   ├── grafana.json
│   └── ...
└── logs/                # Session logs, task completion records
    ├── 2025-11-15.log
    ├── 2025-11-16.log
    └── ...
```

The "thin runtime" is the agent loop itself — a Claude API call with tool use. The "fat filesystem" is everything the agent knows, can do, and has learned. This separation means:

1. **The agent can be restarted without losing state.** All knowledge is on disk.
2. **Skills can be added without changing code.** Drop a new `.md` file in `skills/`.
3. **The agent evolves through its filesystem.** `learnings.md` grows over time. New scripts appear as the team automates more. Skills are refined based on observed failures.

The `soul.md` file defines the agent's identity and operating principles:

```markdown
# Koda — Soul

You are Koda, a production operations agent. You run 24/7 under pm2.

## Core principles
1. Safety first. Never deploy without tests passing. Never modify
   production data without a backup. Never ignore an alert.
2. Ask when uncertain. If a task is ambiguous, ask in #koda-questions
   on Slack. Do not guess.
3. Log everything. Every action, every decision, every error goes
   in the session log. Future-you depends on past-you's notes.
4. Incremental progress. Do one thing, verify it, then do the next.
   Never batch risky operations.

## Communication style
- Be concise in Slack. Use bullet points.
- Be detailed in logs. Include timestamps, command outputs, error traces.
- Never say "I think" — say "I checked X and found Y" or "I don't know".

## Boundaries
- You can read and modify code in the staging environment.
- You can deploy to staging without approval.
- You CANNOT deploy to production without explicit human approval in #deploys.
- You CANNOT modify database schemas without a reviewed migration.
- You CANNOT delete anything. Mark as deprecated, do not delete.
```

The `tasks.json` file tracks the task queue:

```json
{
  "tasks": [
    {
      "id": "task-001",
      "name": "Daily standup summary",
      "schedule": "0 9 * * 1-5",
      "skill": "standup",
      "priority": "high",
      "status": "scheduled",
      "last_run": "2025-11-15T09:00:00Z",
      "last_result": "success",
      "config": {
        "slack_channel": "#engineering",
        "include_prs": true,
        "include_deployments": true,
        "include_incidents": true
      }
    },
    {
      "id": "task-002",
      "name": "Service health check",
      "schedule": "*/5 * * * *",
      "skill": "health-check",
      "priority": "critical",
      "status": "scheduled",
      "last_run": "2025-11-16T14:25:00Z",
      "last_result": "success",
      "config": {
        "services": ["api-gateway", "auth-service", "worker", "postgres"],
        "alert_channel": "#alerts",
        "alert_threshold": "any_unhealthy"
      }
    }
  ]
}
```

Each task references a skill (a Markdown file in `skills/`). The skill contains step-by-step instructions that the agent follows. This is the critical insight: **the agent does not improvise procedures. It reads and follows documented procedures.** When a procedure fails, the agent reads the `self-heal` skill.

### 6.5 The Self-Heal Skill

The self-heal skill is a Markdown file that the agent reads when something goes wrong. It is a decision tree — the agent follows it step by step, checking conditions and taking actions.

```markdown
# Skill: Self-Heal

When a task fails or produces unexpected results, follow these steps
in order. Do NOT skip steps. Log every step's output.

## Step 1: Classify the failure

Read the error output. Classify it as one of:
- **TRANSIENT**: Network timeout, rate limit, temporary unavailability
- **CONFIG**: Missing environment variable, wrong credentials, expired token
- **CODE**: Bug in a script, syntax error, logic error
- **EXTERNAL**: Third-party service down, API changed, certificate expired
- **UNKNOWN**: Cannot determine from the error output alone

## Step 2: TRANSIENT failures

1. Wait 30 seconds
2. Retry the failed task once
3. If it succeeds: log "Transient failure resolved on retry" → DONE
4. If it fails again: wait 60 seconds, retry once more
5. If it fails a third time: escalate to #koda-questions on Slack
   with the error output and the three attempt timestamps

## Step 3: CONFIG failures

1. Check the relevant environment variables: `env | grep <SERVICE_NAME>`
2. Check credential expiry: `./scripts/check-credentials.sh`
3. If credentials are expired:
   a. Run `./scripts/rotate-credentials.sh <SERVICE_NAME>`
   b. Retry the failed task
   c. If it succeeds: log "Resolved by credential rotation" → DONE
4. If environment variables are missing:
   a. Check `.env.example` for the expected variables
   b. Post in #koda-questions: "Missing env var: <NAME>.
      Expected by: <TASK>. Please add to .env"
   c. Mark task as BLOCKED

## Step 4: CODE failures

1. Read the failing script: `cat scripts/<script>.sh`
2. Identify the failing line from the error output
3. Check git log for recent changes: `git log --oneline -5 scripts/<script>.sh`
4. If a recent change introduced the bug:
   a. Attempt a fix if the issue is clear (typo, missing quote, wrong path)
   b. Run the script's tests: `./scripts/test-<script>.sh`
   c. If tests pass: commit fix, retry task
   d. If tests fail: post in #koda-questions with the bug description
5. If no recent changes: the bug may have been latent
   a. Post in #koda-questions with full diagnosis

## Step 5: EXTERNAL failures

1. Check the service's status page (if available)
2. Check https://downdetector.com for the service
3. Post in #koda-questions:
   "External dependency <SERVICE> appears to be down.
    Status page: <URL>
    Impact: <WHICH_TASKS> are blocked.
    Will retry automatically in 15 minutes."
4. Schedule a retry in 15 minutes
5. After 3 failed retries (45 minutes): escalate to #alerts

## Step 6: UNKNOWN failures

1. Collect all available context:
   - Error output (full, untruncated)
   - Recent logs: `tail -100 logs/$(date +%Y-%m-%d).log`
   - System state: `df -h`, `free -m`, `top -bn1 | head -20`
   - Recent changes: `git log --oneline -10`
2. Post in #koda-questions with all collected context
3. Mark task as BLOCKED pending human investigation
```

The self-heal skill is effective because it is **exhaustive and non-creative.** The agent does not need to reason about what to do when something fails — it reads the procedure and follows it. Each step has a clear condition ("If credentials are expired") and a clear action ("Run rotate-credentials.sh"). The decision tree terminates in either a successful resolution or an escalation to humans.

Teams that run long-lived agents report that the self-heal skill reduces human intervention by 60-70% compared to agents that freestyle their error recovery. The agent's improvised error recovery is often wrong — it guesses, tries random things, and makes the problem worse. The documented procedure is tested and known to work.

### 6.6 Anthropic's Managed Agents: Decoupling Brain from Hands

Anthropic's Managed Agents architecture (formally: "Agent Infrastructure") decouples the reasoning engine from the execution environment. The key insight: **the agent (brain) and the sandbox (hands) have different lifecycle requirements.** The brain needs to persist conversation state across crashes. The hands need to provide isolated, reproducible execution environments.

The architecture has three layers:

```
┌──────────────────────────────────────────────────────────┐
│                     BRAIN LAYER                            │
│  Claude model + system prompt + conversation history       │
│  Stateless between API calls                               │
│  State persisted as an append-only event log               │
├──────────────────────────────────────────────────────────┤
│                     SESSION LAYER                          │
│  Session = append-only event log                           │
│  Events: UserMessage, AssistantMessage, ToolCall,          │
│          ToolResult, Error, Checkpoint                     │
│  Session ID is the primary key for all state               │
│  wake(sessionId) resumes from last checkpoint              │
├──────────────────────────────────────────────────────────┤
│                     SANDBOX LAYER                          │
│  Isolated execution environment per session                │
│  Filesystem, network, processes — all sandboxed            │
│  Snapshots enable pause/resume of the execution state      │
│  Multiple sandboxes per session (parallel tool execution)  │
└──────────────────────────────────────────────────────────┘
```

**The session as an append-only event log** is the core abstraction. Every interaction — user messages, assistant responses, tool calls, tool results, errors — is appended to the log. The log is never modified, only extended. This provides:

1. **Crash recovery.** If the agent process crashes, call `wake(sessionId)`. The system reads the event log, reconstructs the conversation state, and resumes from the last checkpoint. No work is lost.

2. **Audit trail.** Every action the agent took is recorded with timestamps. You can replay the entire session to understand why the agent made a specific decision.

3. **Branching.** Fork a session at any point to explore alternative approaches. The forked session shares history up to the fork point and diverges afterward.

4. **Time travel debugging.** Rewind to any checkpoint in the log and resume from there. Useful when the agent went down a wrong path — instead of starting over, rewind to before the mistake.

The `wake(sessionId)` function is the operational primitive for crash recovery:

```python
# Pseudocode for wake(sessionId)
def wake(session_id: str):
    # 1. Load the session's event log
    events = event_store.get_events(session_id)

    # 2. Find the last checkpoint
    last_checkpoint = None
    for event in reversed(events):
        if event.type == "Checkpoint":
            last_checkpoint = event
            break

    # 3. Reconstruct conversation state from events since checkpoint
    messages = []
    for event in events[last_checkpoint.index:]:
        if event.type == "UserMessage":
            messages.append({"role": "user", "content": event.content})
        elif event.type == "AssistantMessage":
            messages.append({"role": "assistant", "content": event.content})
        elif event.type == "ToolResult":
            messages.append({
                "role": "tool",
                "tool_use_id": event.tool_use_id,
                "content": event.result,
            })

    # 4. Restore the sandbox to the checkpoint state
    sandbox = sandbox_manager.restore(session_id, last_checkpoint.sandbox_snapshot)

    # 5. Resume the agent loop
    agent.resume(messages, sandbox)
```

**The sandbox layer** provides isolated execution environments. Each session gets its own sandbox with:
- A filesystem (the project directory, tools, dependencies)
- Network access (configurable — can be restricted to specific hosts)
- Process management (the agent can start long-running processes like dev servers)
- Snapshot/restore capability (pause the sandbox, move to a different machine, resume)

The sandbox is separate from the brain. The brain decides what to do. The sandbox does it. If the sandbox crashes (a runaway process consumes all memory), the brain is unaffected — it simply gets a tool result indicating the sandbox error, and it can request a fresh sandbox.

This decoupling enables several production patterns:

**Horizontal scaling.** The brain runs as a stateless API call. The sandbox runs as a container. You can have many brains sharing a pool of sandboxes, or many sandboxes serving a single brain.

**Mixed environments.** Different tools may require different sandboxes. A Python data analysis tool runs in a Python sandbox. A Node.js build tool runs in a Node sandbox. The brain does not know or care — it calls tools, and the session layer routes to the appropriate sandbox.

**Session hibernation.** A long-running task (e.g., a 6-hour coding project) can be hibernated by snapshotting the sandbox and checkpointing the event log. It resumes hours or days later with full state.

### 6.7 Context Resets vs. Compaction: Choosing the Right Strategy

When an agent's context window fills up, there are two options: compact the existing context (summarize and condense) or reset it entirely (start fresh with structured handoff artifacts).

**Compaction** preserves the conversation's narrative flow. A summarizer condenses the first 80% of the context into a paragraph, and the agent continues with the summary plus the most recent 20%. This works well for short sessions where the early context is mostly setup and the recent context is the actual work.

The problem with compaction over long sessions:

```
Session start:
  [User intent: "Build a task manager with OAuth, team features, and notifications"]

After compaction 1 (50K tokens in):
  [Summary: "Building a task manager. Auth is done. Working on team features."]
  → Lost: the specific OAuth provider requirements

After compaction 2 (100K tokens in):
  [Summary: "Task manager with team features in progress. Some tests failing."]
  → Lost: which tests are failing and why

After compaction 3 (150K tokens in):
  [Summary: "Working on a task manager project."]
  → Lost: nearly everything specific
```

Each compaction is a lossy compression. Details that seemed unimportant at compaction time turn out to be critical later. By the third compaction, the agent has lost most of its understanding of the project requirements.

**Context resets** avoid this degradation. When the context is nearly full, the agent writes its current state to the handoff artifacts (progress file, feature list, git commit), and a new session starts fresh:

```
Session N ends:
  Agent writes to claude-progress.txt:
  "Completed features 46-48. Feature 49 (due dates) is next.
   Known issue: date picker library is not compatible with React 18.
   Will need to use react-day-picker instead of react-datepicker."
  Agent commits all changes.

Session N+1 starts:
  Agent reads claude-progress.txt → knows exactly where to resume
  Agent reads feature_list.json → knows 48/147 features passing
  Agent reads git log → sees recent commits
  Agent runs init.sh → dev environment ready
  Agent starts on feature 49 with full context and no accumulated drift
```

The cost is higher per transition — reading the handoff artifacts costs 2,000-5,000 tokens each time. But the benefit is that each session starts clean. No accumulated summarization errors. No drift from the original intent. No "context anxiety" (the phenomenon Anthropic observed where models rush to finish as they approach the context limit).

**The model-dependent factor.** Anthropic found that different models handle context exhaustion differently:

- **Sonnet 4.5** exhibited "context anxiety" — as it approached the context limit, it began rushing, cutting corners, and producing lower-quality output. Context resets were essential.
- **Opus 4.5** largely eliminated this behavior, maintaining output quality even near the context limit. Compaction with automatic summarization became viable.

The recommendation: **default to context resets for long-horizon tasks.** Switch to compaction only if you have empirical evidence that your specific model handles it well on your specific task type. Test with at least 20 sessions before trusting compaction.

### 6.8 The Init.sh Design Patterns

The `init.sh` script is simple in concept but tricky in practice. Here are patterns from production deployments:

**Pattern 1: Service health checks before startup.**

```bash
#!/bin/bash
set -e

# Check if services are already running (idempotent)
check_service() {
    local name=$1
    local port=$2
    if curl -sf "http://localhost:$port/health" > /dev/null 2>&1; then
        echo "[init.sh] $name already running on port $port"
        return 0
    fi
    return 1
}

# Start PostgreSQL if not running
if ! pg_isready -q 2>/dev/null; then
    echo "[init.sh] Starting PostgreSQL..."
    pg_ctl start -D "$PGDATA" -l /tmp/pg.log -w
else
    echo "[init.sh] PostgreSQL already running"
fi

# Start Redis if not running
if ! redis-cli ping > /dev/null 2>&1; then
    echo "[init.sh] Starting Redis..."
    redis-server --daemonize yes
else
    echo "[init.sh] Redis already running"
fi

# Run migrations (idempotent by design)
echo "[init.sh] Running database migrations..."
npx prisma migrate deploy 2>&1 | tail -3

# Seed test data (idempotent — uses upsert)
echo "[init.sh] Seeding test data..."
npx prisma db seed 2>&1 | tail -3

# Start dev server if not running
if ! check_service "Dev server" 3000; then
    echo "[init.sh] Starting dev server..."
    npm run dev > /tmp/dev.log 2>&1 &
    for i in $(seq 1 30); do
        check_service "Dev server" 3000 && break
        [ "$i" = "30" ] && { echo "[init.sh] FATAL: Dev server failed to start"; cat /tmp/dev.log | tail -20; exit 1; }
        sleep 1
    done
fi

echo "[init.sh] All services ready."
echo "[init.sh] Dev server: http://localhost:3000"
echo "[init.sh] PostgreSQL: localhost:5432"
echo "[init.sh] Redis: localhost:6379"
```

**Pattern 2: Environment variable verification.**

```bash
# Verify required environment variables before starting anything
REQUIRED_VARS="DATABASE_URL REDIS_URL SESSION_SECRET"
MISSING=""
for var in $REQUIRED_VARS; do
    if [ -z "${!var}" ]; then
        MISSING="$MISSING $var"
    fi
done
if [ -n "$MISSING" ]; then
    echo "[init.sh] ERROR: Missing required environment variables:$MISSING"
    echo "[init.sh] Copy .env.example to .env and fill in the values."
    exit 1
fi
```

**Pattern 3: Cleanup stale processes.**

```bash
# Kill stale processes from a previous crashed session
# IMPORTANT: use specific PIDs, never pkill -f
if [ -f /tmp/dev-server.pid ]; then
    OLD_PID=$(cat /tmp/dev-server.pid)
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "[init.sh] Killing stale dev server (PID $OLD_PID)..."
        kill "$OLD_PID"
        sleep 2
    fi
    rm -f /tmp/dev-server.pid
fi
```

### 6.9 Puppeteer MCP for End-to-End Testing

The agent needs to verify that features work in a real browser, not just that the code compiles. Puppeteer MCP (or Playwright MCP) gives the agent browser automation capabilities through the MCP protocol.

The testing pattern:

```
Agent: I've implemented the signup form. Let me verify it works.

[Tool call: puppeteer_navigate]
  url: "http://localhost:3000/signup"

[Tool result: Screenshot showing the signup page with email and password fields]

Agent: The form renders correctly. Let me fill it out and submit.

[Tool call: puppeteer_fill]
  selector: "input[name='email']"
  value: "test@example.com"

[Tool call: puppeteer_fill]
  selector: "input[name='password']"
  value: "TestPassword123!"

[Tool call: puppeteer_click]
  selector: "button[type='submit']"

[Tool result: Screenshot showing the dashboard with "Welcome, test@example.com"]

Agent: Signup works. Let me verify the database record.

[Tool call: bash]
  command: "psql $DATABASE_URL -c \"SELECT email FROM users WHERE email='test@example.com'\""

[Tool result: email | test@example.com]

Agent: Feature #4 (User can sign up) passes all testing steps.
  Updating feature_list.json...
```

This is the complete verification loop: implement → render → interact → verify state. The agent does not just check that the code compiles or that the API returns 200. It fills out the form in a real browser, clicks the button, sees the result, and verifies the database state.

The testing steps in `feature_list.json` map directly to Puppeteer MCP operations:

| Testing Step | Puppeteer MCP Operation |
|---|---|
| "Navigate to /signup" | `puppeteer_navigate({ url: "http://localhost:3000/signup" })` |
| "Enter email 'test@example.com'" | `puppeteer_fill({ selector: "input[name='email']", value: "test@example.com" })` |
| "Click 'Sign Up'" | `puppeteer_click({ selector: "button[type='submit']" })` |
| "Verify redirect to /dashboard" | `puppeteer_navigate` result shows /dashboard URL |
| "Verify welcome message" | `puppeteer_evaluate({ script: "document.querySelector('.welcome').textContent" })` |

### 6.10 Scaling: pm2 Configuration for 24/7 Operation

Production long-horizon agents run under a process manager. pm2 is the most common choice for Node.js-based agent harnesses:

```javascript
// ecosystem.config.js — pm2 configuration for Koda agent
module.exports = {
  apps: [
    {
      name: "koda-agent",
      script: "./agent.js",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 30000, // 30 seconds between restarts
      max_memory_restart: "2G",
      cron_restart: "0 3 * * *", // Restart daily at 3 AM for clean state
      env: {
        NODE_ENV: "production",
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        LOG_LEVEL: "info",
        SESSION_DIR: "/var/koda/sessions",
        SKILLS_DIR: "/var/koda/skills",
      },
      error_file: "/var/log/koda/error.log",
      out_file: "/var/log/koda/out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
    },
    {
      name: "koda-scheduler",
      script: "./scheduler.js",
      instances: 1,
      autorestart: true,
      env: {
        TASKS_FILE: "/var/koda/tasks.json",
        AGENT_ENDPOINT: "http://localhost:3100/trigger",
      },
    },
  ],
};
```

The scheduler reads `tasks.json` and triggers the agent on the configured cron schedules. The agent process handles the actual task execution. They communicate through a local HTTP endpoint — the scheduler POSTs a task ID, the agent reads the task definition and the corresponding skill, and executes.

Key configuration decisions:

- **`max_restarts: 10`** prevents infinite crash loops. After 10 restarts, pm2 stops the agent and alerts the team.
- **`restart_delay: 30000`** (30 seconds) gives external services time to recover. If the agent crashes because a dependency is down, an immediate restart just crashes again.
- **`cron_restart: "0 3 * * *"`** provides a daily clean slate. Memory leaks, accumulated file handles, and stale caches are cleared.
- **`max_memory_restart: "2G"`** catches memory leaks before they affect the host system.

### 6.11 The Filesystem as the Agent's Memory

The Koda architecture reveals a broader pattern: **the filesystem is the most durable, debuggable, and interoperable memory system for agents.** Database-backed memory systems are faster for lookup but opaque to humans. Vector stores are useful for semantic search but lose structural relationships. The filesystem has unique advantages:

1. **Human-readable.** You can `cat soul.md` and instantly understand the agent's identity. You can `ls skills/` and see every procedure it knows.
2. **Version-controlled.** Put the agent's filesystem in git and you have complete history of how the agent evolved.
3. **Toolable.** The agent already has Read, Write, Edit, Grep, and Glob tools. Every filesystem operation is a tool it already knows how to use.
4. **Composable.** Skills reference other skills. Scripts call other scripts. The filesystem's directory structure is the composition mechanism.
5. **Debuggable.** When the agent does something wrong, you read the log file, trace back to the skill it followed, and find the step where it diverged.

The tradeoff is performance. Reading a file takes 10-50ms. A database query takes 1-5ms. For agents that process thousands of requests per second, the filesystem is too slow. For agents that run 21 scheduled tasks per day, it is plenty fast.

### 6.12 The Architecture Summary

The long-horizon harness pattern reduces to five principles:

**1. Separate initialization from execution.** The initializer creates the project structure, feature list, and development environment once. The coding agent uses them repeatedly. This prevents the agent from re-inventing project structure on every session.

**2. Persist state as structured artifacts.** Progress files, feature lists, and git history provide complete state transfer across context boundaries. The cost is ~2,000 tokens per session. The benefit is zero state loss.

**3. Fix before you build.** Every session starts with a smoke test. If the app is broken, fix it before adding features. This prevents technical debt accumulation across sessions.

**4. Test against acceptance criteria.** The feature list defines what "done" means. The agent cannot self-certify — it must pass every testing step defined by the initializer. This prevents premature victory declarations.

**5. Evolve through the filesystem.** Skills, learnings, and configuration accumulate on disk. The agent reads them, follows them, and extends them. The filesystem is the agent's long-term memory, and it is human-readable, version-controlled, and debuggable.

These principles are not theoretical. They come from Anthropic's published research, from production systems like Koda, and from the hard-won experience of teams running agents continuously. Every production long-horizon agent implements some variation of this pattern — because the failure modes are universal, and the fixes are structural.

---

*End of Part II*
