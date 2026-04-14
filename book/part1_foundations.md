# Part I: Foundations — The Engineering of Agent Systems

---

# Chapter 1: The Agent Loop in Practice

## 1.1 The HTTP Anatomy of an Agent Turn

Every agent loop iteration is, at the wire level, an HTTP POST. Understanding the exact request and response shapes — not abstract diagrams — is the prerequisite for building, debugging, and optimizing agents.

### OpenAI Responses API: The Codex Agent Loop

The Responses API (`POST https://api.openai.com/v1/responses`) is what powers Codex. Here is the exact first request of a Codex-style agent session:

```http
POST /v1/responses HTTP/1.1
Host: api.openai.com
Authorization: Bearer sk-...
Content-Type: application/json

{
  "model": "o3-mini",
  "instructions": "You are a coding agent operating in a sandboxed environment. You have access to the full repository at /workspace. Always read files before editing. Run tests after changes. If tests fail, debug and fix before reporting completion.",
  "input": [
    {
      "role": "user",
      "content": "The login endpoint returns 500 when the email contains a plus sign. Fix it."
    }
  ],
  "tools": [
    {
      "type": "function",
      "name": "shell",
      "description": "Execute a shell command in the sandbox and return stdout/stderr.",
      "parameters": {
        "type": "object",
        "properties": {
          "command": {
            "type": "string",
            "description": "The shell command to execute"
          },
          "timeout": {
            "type": "integer",
            "description": "Timeout in seconds (default 30)"
          }
        },
        "required": ["command"]
      }
    },
    {
      "type": "function",
      "name": "read_file",
      "description": "Read a file from the filesystem. Returns content with line numbers.",
      "parameters": {
        "type": "object",
        "properties": {
          "path": { "type": "string" },
          "offset": { "type": "integer", "description": "Start line (0-indexed)" },
          "limit": { "type": "integer", "description": "Max lines to return" }
        },
        "required": ["path"]
      }
    },
    {
      "type": "function",
      "name": "write_file",
      "description": "Write content to a file, creating it if necessary.",
      "parameters": {
        "type": "object",
        "properties": {
          "path": { "type": "string" },
          "content": { "type": "string" }
        },
        "required": ["path", "content"]
      }
    },
    {
      "type": "function",
      "name": "str_replace",
      "description": "Replace an exact string in a file. Fails if old_string is not found or is ambiguous.",
      "parameters": {
        "type": "object",
        "properties": {
          "path": { "type": "string" },
          "old_string": { "type": "string" },
          "new_string": { "type": "string" }
        },
        "required": ["path", "old_string", "new_string"]
      }
    }
  ],
  "stream": true,
  "max_output_tokens": 16384
}
```

The response streams back as Server-Sent Events. A typical first turn:

```
event: response.output_item.added
data: {"type":"function_call","name":"shell","call_id":"call_abc123","arguments":""}

event: response.function_call_arguments.delta
data: {"delta":"{\"command\":\"grep -rn 'email' src/routes/auth.ts\"}"}

event: response.function_call_arguments.done
data: {"arguments":"{\"command\":\"grep -rn 'email' src/routes/auth.ts\"}"}

event: response.output_item.done
data: {"type":"function_call","name":"shell","call_id":"call_abc123","status":"completed"}
```

The client-side agent loop then:
1. Parses the function call from the stream
2. Executes it in the sandbox: `grep -rn 'email' src/routes/auth.ts`
3. Captures stdout/stderr
4. Posts the result back in the next request, referencing the `call_id`

The follow-up request appends the tool output:

```json
{
  "model": "o3-mini",
  "previous_response_id": "resp_xyz789",
  "input": [
    {
      "type": "function_call_output",
      "call_id": "call_abc123",
      "output": "src/routes/auth.ts:47:  const email = req.body.email;\nsrc/routes/auth.ts:48:  const user = await db.users.findOne({ email });\nsrc/routes/auth.ts:52:  const normalized = email.toLowerCase();"
    }
  ],
  "stream": true
}
```

This is the fundamental rhythm: POST with tool results → stream back reasoning + tool calls → execute → POST again. The `previous_response_id` field enables server-side conversation tracking so the client doesn't need to re-send the full history.

### The Exact Turn Sequence of a Real Bug Fix

Here is the complete sequence for the plus-sign email bug, with actual token counts at each step:

```
Turn 1: Agent searches for email handling
  Request:  1,847 tokens (system + tools + user message)
  Response: shell("grep -rn 'email' src/routes/auth.ts")
  Output:   89 tokens
  Latency:  340ms model + 45ms tool execution

Turn 2: Agent reads the auth route file
  Request:  2,291 tokens (previous + tool result)
  Response: read_file("src/routes/auth.ts")
  Output:   0 tokens (tool call only)
  Latency:  280ms model + 12ms tool execution

Turn 3: Agent receives file content (187 lines), identifies the bug
  Request:  4,103 tokens (previous + file content)
  Response: read_file("src/utils/validation.ts")
  Output:   0 tokens
  Latency:  450ms model + 8ms tool execution
  
Turn 4: Agent reads validation utility, finds the regex
  Request:  5,422 tokens
  Response: str_replace on validation.ts — changes /^[\w.]+@/ to /^[\w.+]+@/
  Output:   47 tokens (explanation text)
  Latency:  520ms model + 5ms tool execution

Turn 5: Agent runs the test suite
  Request:  5,891 tokens
  Response: shell("npm test -- --grep 'email'")
  Output:   0 tokens
  Latency:  310ms model + 4,200ms tool execution

Turn 6: Tests pass, agent verifies with a curl command
  Request:  7,234 tokens (test output added)
  Response: shell("curl -X POST localhost:3000/login -d '{\"email\":\"user+tag@example.com\",\"password\":\"test\"}'")
  Output:   0 tokens
  Latency:  290ms model + 180ms tool execution

Turn 7: Agent confirms fix, provides summary
  Request:  7,891 tokens
  Response: text-only (no tool calls) — "Fixed. The email validation regex..."
  Output:   156 tokens
  Latency:  380ms model

Total: 7 turns, ~7,900 input tokens (final), 203 output tokens, ~6.6s model time, ~4.5s tool time
Estimated cost: $0.027 (with prompt caching)
```

The critical observation: input tokens grow monotonically because the conversation is append-only. Output tokens per turn are tiny — the model generates a tool call (30-80 tokens) or a short response. The 100:1 input-to-output ratio that Manus AI reported is visible even in this short session.

### Anthropic Messages API: The Claude Code Loop

Claude Code uses the Anthropic Messages API (`POST https://api.anthropic.com/v1/messages`). The request structure differs from OpenAI's in important ways:

```http
POST /v1/messages HTTP/1.1
Host: api.anthropic.com
x-api-key: sk-ant-...
anthropic-version: 2023-06-01
Content-Type: application/json

{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 16000,
  "system": [
    {
      "type": "text",
      "text": "You are Claude Code, an interactive CLI tool that helps with software engineering tasks...",
      "cache_control": {"type": "ephemeral"}
    }
  ],
  "tools": [
    {
      "name": "read_file",
      "description": "Read the contents of a file at the specified path. Use this to examine existing files you need to understand or modify. The output includes line numbers prefixed to each line.",
      "input_schema": {
        "type": "object",
        "properties": {
          "file_path": {
            "type": "string",
            "description": "The absolute path to the file to read"
          },
          "offset": {
            "type": "integer",
            "description": "The line offset to start reading from"
          },
          "limit": {
            "type": "integer",
            "description": "The number of lines to read"
          }
        },
        "required": ["file_path"]
      }
    },
    {
      "name": "write_to_file",
      "description": "Write content to a file at the specified path.",
      "input_schema": {
        "type": "object",
        "properties": {
          "file_path": { "type": "string" },
          "content": { "type": "string" }
        },
        "required": ["file_path", "content"]
      }
    },
    {
      "name": "edit_file",
      "description": "Make a targeted edit to a file using exact string matching.",
      "input_schema": {
        "type": "object",
        "properties": {
          "file_path": { "type": "string" },
          "old_string": { "type": "string", "description": "The exact text to find (must be unique in the file)" },
          "new_string": { "type": "string" },
          "replace_all": { "type": "boolean", "default": false }
        },
        "required": ["file_path", "old_string", "new_string"]
      }
    },
    {
      "name": "bash",
      "description": "Execute a shell command. Each command runs in its own shell but inherits the working directory and environment from previous commands.",
      "input_schema": {
        "type": "object",
        "properties": {
          "command": { "type": "string" },
          "timeout": { "type": "integer", "description": "Timeout in milliseconds" }
        },
        "required": ["command"]
      }
    },
    {
      "name": "glob",
      "description": "Find files matching a glob pattern.",
      "input_schema": {
        "type": "object",
        "properties": {
          "pattern": { "type": "string" },
          "path": { "type": "string", "description": "Directory to search in" }
        },
        "required": ["pattern"]
      }
    },
    {
      "name": "grep",
      "description": "Search for a pattern in files using ripgrep.",
      "input_schema": {
        "type": "object",
        "properties": {
          "pattern": { "type": "string" },
          "path": { "type": "string" },
          "include": { "type": "string", "description": "File glob to include" }
        },
        "required": ["pattern"]
      }
    },
    {
      "name": "list_directory",
      "description": "List the contents of a directory.",
      "input_schema": {
        "type": "object",
        "properties": {
          "path": { "type": "string" }
        },
        "required": ["path"]
      }
    },
    {
      "name": "todo_write",
      "description": "Create or update a structured TODO list for tracking task progress.",
      "input_schema": {
        "type": "object",
        "properties": {
          "todos": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": { "type": "string" },
                "content": { "type": "string" },
                "status": { "type": "string", "enum": ["pending", "in_progress", "completed"] }
              },
              "required": ["id", "content", "status"]
            }
          }
        },
        "required": ["todos"]
      }
    },
    {
      "name": "task",
      "description": "Spawn a sub-agent to work on a focused subtask in an isolated context.",
      "input_schema": {
        "type": "object",
        "properties": {
          "description": { "type": "string" },
          "prompt": { "type": "string" }
        },
        "required": ["description", "prompt"]
      }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "Fix the failing test in test_auth.py"
    }
  ]
}
```

The response comes back as JSON (or streamed SSE with `"stream": true`):

```json
{
  "id": "msg_01XFDUDYJgAACzvnptvVoYEL",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "I'll start by looking at the failing test to understand what's expected."
    },
    {
      "type": "tool_use",
      "id": "toolu_01A09q90qw90lq917835lq9",
      "name": "read_file",
      "input": {
        "file_path": "/workspace/test_auth.py"
      }
    }
  ],
  "model": "claude-sonnet-4-20250514",
  "stop_reason": "tool_use",
  "usage": {
    "input_tokens": 2847,
    "output_tokens": 94,
    "cache_creation_input_tokens": 2411,
    "cache_read_input_tokens": 0
  }
}
```

The critical field is `stop_reason`. When it's `"tool_use"`, the loop continues. When it's `"end_turn"`, the agent is done. The `usage` block tells you exactly what was cached — on this first turn, 2,411 tokens were written to cache (the system prompt + tools), 0 were read from cache. On the next turn, those 2,411 tokens will be cache hits.

The tool result goes back as a `user` message with `tool_result` content blocks:

```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_01A09q90qw90lq917835lq9",
      "content": "  1|import pytest\n  2|from auth import validate_email, hash_password\n  3|\n  4|class TestAuth:\n  5|    def test_valid_email(self):\n  6|        assert validate_email('user@example.com') == True\n  7|\n  8|    def test_invalid_email_no_at(self):\n  9|        assert validate_email('userexample.com') == False\n 10|\n 11|    def test_email_with_plus(self):\n 12|        assert validate_email('user+tag@example.com') == True  # FAILING"
    }
  ]
}
```

This append-to-messages/call-again pattern repeats. The entire Claude Code agent is, as Anthropic engineers have stated publicly, a `while(tool_use)` loop around this API.

---

## 1.2 Building a Production Agent Loop from Scratch

Here is a minimal but production-capable agent loop in Python. This is not a toy — it handles compaction, token counting, streaming, error recovery, and termination. Every production agent (Claude Code, Codex, Cursor, Devin) is a variation on this structure.

```python
import anthropic
import json
import time
import subprocess
from pathlib import Path

client = anthropic.Anthropic()

SYSTEM_PROMPT = """You are an autonomous coding agent. You operate in a loop: read code, 
understand the problem, make targeted fixes, and verify with tests.

Rules:
- Always read a file before editing it.
- Use edit_file for targeted changes, not write_to_file for full rewrites.
- Run tests after every change.
- If tests fail after your fix, debug and iterate — do not give up.
- When done, provide a one-line summary of what you changed and why."""

TOOLS = [
    {
        "name": "bash",
        "description": "Execute a shell command. Returns stdout and stderr.",
        "input_schema": {
            "type": "object",
            "properties": {
                "command": {"type": "string"}
            },
            "required": ["command"]
        }
    },
    {
        "name": "read_file",
        "description": "Read a file. Returns content with line numbers.",
        "input_schema": {
            "type": "object",
            "properties": {
                "file_path": {"type": "string"},
                "offset": {"type": "integer"},
                "limit": {"type": "integer"}
            },
            "required": ["file_path"]
        }
    },
    {
        "name": "edit_file",
        "description": "Replace old_string with new_string in a file. old_string must match exactly and uniquely.",
        "input_schema": {
            "type": "object",
            "properties": {
                "file_path": {"type": "string"},
                "old_string": {"type": "string"},
                "new_string": {"type": "string"}
            },
            "required": ["file_path", "old_string", "new_string"]
        }
    }
]

MAX_TOOL_OUTPUT_CHARS = 30_000
MAX_TURNS = 60
COMPACT_THRESHOLD_TOKENS = 90_000


def execute_tool(name: str, input_data: dict) -> str:
    if name == "bash":
        try:
            result = subprocess.run(
                input_data["command"], shell=True,
                capture_output=True, text=True, timeout=30
            )
            output = result.stdout + result.stderr
        except subprocess.TimeoutExpired:
            output = "ERROR: Command timed out after 30 seconds"
    elif name == "read_file":
        path = Path(input_data["file_path"])
        if not path.exists():
            return f"ERROR: File not found: {path}"
        lines = path.read_text().splitlines()
        start = input_data.get("offset", 0)
        end = start + input_data.get("limit", len(lines))
        numbered = [f"{i+1:>4}|{line}" for i, line in enumerate(lines[start:end], start=start)]
        output = "\n".join(numbered)
    elif name == "edit_file":
        path = Path(input_data["file_path"])
        content = path.read_text()
        old = input_data["old_string"]
        if content.count(old) == 0:
            return f"ERROR: old_string not found in {path}"
        if content.count(old) > 1:
            return f"ERROR: old_string matches {content.count(old)} locations. Make it more specific."
        content = content.replace(old, input_data["new_string"], 1)
        path.write_text(content)
        output = f"OK: Replaced in {path}"
    else:
        output = f"ERROR: Unknown tool: {name}"
    
    if len(output) > MAX_TOOL_OUTPUT_CHARS:
        half = MAX_TOOL_OUTPUT_CHARS // 2
        output = output[:half] + f"\n\n[...truncated {len(output) - MAX_TOOL_OUTPUT_CHARS} chars...]\n\n" + output[-half:]
    
    return output


def estimate_tokens(messages: list, system: str, tools: list) -> int:
    """Rough token estimate: 1 token ≈ 4 chars for English text/code."""
    total_chars = len(system) + len(json.dumps(tools))
    for msg in messages:
        if isinstance(msg.get("content"), str):
            total_chars += len(msg["content"])
        elif isinstance(msg.get("content"), list):
            for block in msg["content"]:
                if isinstance(block, dict):
                    total_chars += len(json.dumps(block))
    return total_chars // 4


def compact_messages(messages: list) -> list:
    """Remove older tool results, keeping the first message and recent turns."""
    if len(messages) <= 6:
        return messages
    
    first_msg = messages[0]
    recent = messages[-6:]
    middle = messages[1:-6]
    
    compacted_middle = []
    for msg in middle:
        if isinstance(msg.get("content"), list):
            new_content = []
            for block in msg["content"]:
                if isinstance(block, dict) and block.get("type") == "tool_result":
                    text = block.get("content", "")
                    if len(text) > 500:
                        new_content.append({**block, "content": text[:200] + "\n[...compacted...]"})
                    else:
                        new_content.append(block)
                else:
                    new_content.append(block)
            compacted_middle.append({**msg, "content": new_content})
        else:
            compacted_middle.append(msg)
    
    return [first_msg] + compacted_middle + recent


def run_agent(goal: str) -> str:
    messages = [{"role": "user", "content": goal}]
    
    total_input_tokens = 0
    total_output_tokens = 0
    start_time = time.time()
    
    for turn in range(MAX_TURNS):
        token_est = estimate_tokens(messages, SYSTEM_PROMPT, TOOLS)
        if token_est > COMPACT_THRESHOLD_TOKENS:
            messages = compact_messages(messages)
            print(f"  [compacted at turn {turn}, ~{token_est} tokens -> ~{estimate_tokens(messages, SYSTEM_PROMPT, TOOLS)} tokens]")
        
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=16000,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages,
        )
        
        total_input_tokens += response.usage.input_tokens
        total_output_tokens += response.usage.output_tokens
        
        messages.append({"role": "assistant", "content": response.content})
        
        if response.stop_reason == "end_turn":
            elapsed = time.time() - start_time
            text_blocks = [b.text for b in response.content if hasattr(b, 'text')]
            final_text = "\n".join(text_blocks)
            print(f"\n  Completed in {turn+1} turns, {elapsed:.1f}s")
            print(f"  Tokens: {total_input_tokens:,} input, {total_output_tokens:,} output")
            cached = getattr(response.usage, 'cache_read_input_tokens', 0)
            if cached:
                print(f"  Cache hits: {cached:,} tokens ({cached/response.usage.input_tokens*100:.0f}%)")
            return final_text
        
        tool_results = []
        for block in response.content:
            if block.type == "tool_use":
                print(f"  Turn {turn+1}: {block.name}({json.dumps(block.input)[:120]})")
                result = execute_tool(block.name, block.input)
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result,
                })
        
        messages.append({"role": "user", "content": tool_results})
    
    return f"ERROR: Max turns ({MAX_TURNS}) reached without completion."
```

This is 120 lines. Production agents add error handling, permission checks, streaming UI, and observability on top of this core, but the fundamental structure is identical. Claude Code's core loop, stripped of UI and permission logic, reduces to this.

---

## 1.3 The Claude Code Loop: SystemPromptBuilder and the 19-Tool Architecture

In January 2025, the Claude Code system prompt leaked. It revealed a sophisticated prompt assembly pipeline far beyond a static string. The system, implemented in approximately 14,902 lines of TypeScript, dynamically assembles the system prompt from 40+ sections.

### The SystemPromptBuilder Architecture

The prompt builder follows a clear pattern: each section is a function that returns a string or null (if the section is inapplicable). These sections are concatenated in a fixed order:

```typescript
class SystemPromptBuilder {
  private sections: PromptSection[] = [];
  
  build(context: SessionContext): string {
    const parts: string[] = [];
    
    // Static sections (cacheable)
    parts.push(this.coreIdentity());
    parts.push(this.coreCapabilities());
    parts.push(this.toolDocumentation(context.permissionLevel));
    parts.push(this.behavioralRules());
    parts.push(this.outputFormatting());
    parts.push(this.safetyConstraints());
    parts.push(this.memoryInstructions());
    parts.push(this.antiDistillation());
    
    // Cache boundary marker
    parts.push("__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__");
    
    // Dynamic sections (per-session, not cached)
    parts.push(this.environmentInfo(context));
    parts.push(this.projectMemory(context));
    parts.push(this.sessionState(context));
    parts.push(this.containerDetection());
    
    return parts.filter(Boolean).join("\n\n");
  }
}
```

The `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` marker is the cache boundary. Everything above it is identical across sessions and gets cached in the KV-cache. Everything below it changes per session. This boundary is the single most cost-impactful design decision in Claude Code — with the static portion comprising roughly 70% of the system prompt, millions of cached-token dollars are saved across the user base.

### The 19 Tools with Permission Tiers

The leaked prompt reveals a three-tier permission model for tools:

**ReadOnly tier** (always available, no confirmation needed):
```
read_file       — Read file contents with line numbers
list_directory  — List directory contents
glob            — Find files by glob pattern
grep            — Search file contents with ripgrep
web_search      — Search the web
web_fetch       — Fetch a URL and convert to markdown
todo_read       — Read the current TODO list
```

**WorkspaceWrite tier** (available in standard mode, may prompt for confirmation):
```
write_to_file   — Create or overwrite a file
edit_file       — Targeted search-and-replace edit
multi_edit      — Multiple edits to a single file
todo_write      — Create or update TODO items
notebook_edit   — Edit Jupyter notebook cells
```

**FullAccess tier** (requires explicit permission or --dangerously-skip-permissions flag):
```
bash            — Execute arbitrary shell commands
task            — Spawn a sub-agent
```

The permission logic at the tool execution layer:

```typescript
async function executeToolWithPermission(
  tool: ToolCall,
  permissionLevel: PermissionLevel,
  userAllowlist: string[]
): Promise<ToolResult> {
  const toolTier = TOOL_PERMISSION_MAP[tool.name];
  
  if (toolTier === "ReadOnly") {
    return executeTool(tool);
  }
  
  if (toolTier === "WorkspaceWrite") {
    if (permissionLevel >= PermissionLevel.WorkspaceWrite) {
      return executeTool(tool);
    }
    return promptUserForPermission(tool);
  }
  
  if (toolTier === "FullAccess") {
    if (tool.name === "bash") {
      const command = tool.input.command;
      if (userAllowlist.some(pattern => matchGlob(command, pattern))) {
        return executeTool(tool);
      }
      if (isSafeCommand(command)) {
        return executeTool(tool);
      }
    }
    return promptUserForPermission(tool);
  }
}

function isSafeCommand(command: string): boolean {
  const safePatterns = [
    /^ls\b/, /^cat\b/, /^head\b/, /^tail\b/, /^wc\b/,
    /^find\b/, /^grep\b/, /^rg\b/, /^git\s+(status|log|diff|show)\b/,
    /^python\s+--version/, /^node\s+--version/, /^npm\s+--version/,
  ];
  return safePatterns.some(p => p.test(command.trim()));
}
```

### The Actual System Prompt Structure (Reconstructed from Leak)

The core identity section opens with:

```
You are Claude Code, an interactive CLI tool that helps users with software 
engineering tasks. You operate as an autonomous agent, using tools to explore 
codebases, make changes, and verify your work.

You have access to the following tools, organized by permission level:

## ReadOnly Tools (always available)
...

## WorkspaceWrite Tools (require workspace write permission)
...

## FullAccess Tools (require explicit user permission)
...
```

The behavioral rules section includes specific, non-obvious directives:

```
## Behavioral Rules

1. ALWAYS read a file before editing it. Never edit a file you haven't read 
   in this session.
2. Use edit_file for targeted changes. Only use write_to_file when creating 
   new files or when the entire content must change.
3. Run tests after making changes. If the project has a test command, use it.
4. If you encounter an error, try at least 3 different approaches before 
   asking the user for help.
5. When working on a task with multiple steps, use todo_write to track 
   your progress.
6. Never commit code without running tests first.
7. If you need to install dependencies, always check the project's package 
   manager first (package-lock.json → npm, yarn.lock → yarn, 
   pnpm-lock.yaml → pnpm).
8. Keep your responses concise. Don't explain what you're about to do — 
   just do it. Explain what you did after.
9. If a file is too large to read in one call, use offset and limit to 
   read in chunks.
10. When editing, your old_string must be unique in the file. If it's not, 
    include more surrounding context to disambiguate.
```

The output formatting section constrains the model's response style:

```
## Output Formatting

- Use markdown for structured responses.
- Use backticks for file paths, function names, and code identifiers.
- Do not use emojis unless the user does.
- When showing file changes, describe what changed and why, not the full 
  before/after.
- End task completion messages with a brief summary of changes made.
```

### The While Loop with Error Recovery

The core execution loop in Claude Code handles several edge cases that most tutorials omit:

```typescript
async function agentLoop(
  initialMessage: string,
  context: SessionContext
): Promise<string> {
  const messages: Message[] = [{ role: "user", content: initialMessage }];
  const systemPrompt = new SystemPromptBuilder().build(context);
  let hasAttemptedReactiveCompact = false;
  let consecutiveErrors = 0;
  
  while (true) {
    let response: APIResponse;
    
    try {
      response = await client.messages.create({
        model: context.model,
        max_tokens: 16000,
        system: systemPrompt,
        tools: context.tools,
        messages: messages,
      });
      consecutiveErrors = 0;
    } catch (error) {
      if (isContextLengthError(error)) {
        if (hasAttemptedReactiveCompact) {
          // BUG (now fixed): This used to not reset, causing infinite retry loops.
          // Each compaction attempt would re-trigger the context length error,
          // and without the boolean guard, the agent would burn API calls
          // until the session timed out or hit rate limits.
          throw new Error("Context too large even after compaction");
        }
        hasAttemptedReactiveCompact = true;
        messages = await reactiveCompact(messages);
        continue;
      }
      
      consecutiveErrors++;
      if (consecutiveErrors >= 3) {
        throw error;
      }
      await sleep(Math.pow(2, consecutiveErrors) * 1000);
      continue;
    }
    
    messages.push({ role: "assistant", content: response.content });
    
    if (response.stop_reason === "end_turn") {
      return extractText(response.content);
    }
    
    if (response.stop_reason === "max_tokens") {
      // Output token exhaustion — the 3-step escalation:
      // Step 1: Try with higher max_tokens
      // Step 2: Compact context to free up token budget
      // Step 3: Ask the model to be more concise
      messages = await handleMaxTokens(messages, context);
      continue;
    }
    
    // Execute tool calls and collect results
    const toolResults: ToolResult[] = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        const result = await executeToolWithPermission(
          block, context.permissionLevel, context.userAllowlist
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: truncateToolOutput(result, MAX_TOOL_OUTPUT_CHARS),
        });
      }
    }
    
    messages.push({ role: "user", content: toolResults });
    hasAttemptedReactiveCompact = false; // Reset after successful turn
  }
}
```

The `hasAttemptedReactiveCompact` bug is worth examining in detail. Before the fix, the boolean was never reset after a successful turn. So if the agent hit a context length error, compacted, succeeded for 20 more turns, then hit another context length error, the guard would prevent a second compaction and the agent would throw. The fix — resetting the boolean after each successful API call — is a single line, but without it, long-running sessions would reliably crash.

### The "Hidden Error" Pattern

When Claude Code encounters a context-length error, it does not display this to the user. Instead, it silently compacts the conversation and retries. From the user's perspective, the agent simply continues working. This is intentional — exposing internal error recovery to users creates unnecessary anxiety and support burden.

```typescript
async function reactiveCompact(messages: Message[]): Promise<Message[]> {
  // Don't show this to the user — it's internal housekeeping
  const compacted = await compactConversation(messages, {
    strategy: "preserve_recent",
    keepFirstMessage: true,
    keepLastNTurns: 6,
    summarizeMiddle: true,
  });
  
  // Log for observability, but don't surface to UI
  logger.info("reactive_compact", {
    before_tokens: estimateTokens(messages),
    after_tokens: estimateTokens(compacted),
    turns_removed: messages.length - compacted.length,
  });
  
  return compacted;
}
```

---

## 1.4 Cursor's Three-Layer Architecture

Cursor is architecturally distinct from Claude Code and Codex. It's a VS Code fork with three layers that cooperate to provide agent capabilities: the IDE layer, the AI orchestration layer, and the context engine.

### Layer 1: Priompt — Priority-Based Context Compilation

Cursor's most innovative contribution is **Priompt** (Priority Prompt), a JSX-based system for declaratively specifying context with priorities. Instead of manually concatenating strings and hoping they fit in the context window, Priompt treats context compilation as a constraint satisfaction problem.

```tsx
function buildAgentContext(request: AgentRequest): PromptElement {
  return (
    <SystemMessage priority={1000}>
      You are Cursor, an AI coding assistant integrated into the IDE.
    </SystemMessage>
    
    <SystemMessage priority={990}>
      <ToolDefinitions tools={request.availableTools} />
    </SystemMessage>
    
    <SystemMessage priority={900}>
      <ProjectRules path={request.workspacePath} />
    </SystemMessage>
    
    <UserMessage priority={800}>
      <RecentFiles files={request.recentlyEditedFiles} maxTokens={4000} />
    </UserMessage>
    
    <UserMessage priority={700}>
      <CodebaseSearchResults query={request.userQuery} maxResults={10} />
    </UserMessage>
    
    <UserMessage priority={600}>
      <DiagnosticErrors files={request.openFiles} />
    </UserMessage>
    
    <UserMessage priority={500}>
      <GitDiff maxTokens={2000} />
    </UserMessage>
    
    <ConversationHistory priority={400} messages={request.history} />
    
    <UserMessage priority={1000}>
      {request.currentMessage}
    </UserMessage>
  );
}
```

The Priompt compiler takes this JSX tree and a token budget, then greedily includes elements by priority until the budget is exhausted. Priority 1000 elements are always included. Lower-priority elements are dropped first when space is constrained. This means that the user's current message and system instructions are guaranteed to be present, while older conversation history or search results may be truncated.

The compilation algorithm:

```
1. Flatten the JSX tree into a list of (priority, tokens, content) tuples
2. Sort by priority descending
3. Greedily include elements:
   - If element fits in remaining budget, include it
   - If element has a maxTokens prop, truncate it to that limit first
   - If element doesn't fit, skip it (or truncate if it's the lowest-priority included element)
4. Re-order included elements back into their original document order
5. Serialize to the API's message format
```

This solves a problem that plagues every hand-rolled context builder: when you have 20 sources of context and a 128K token budget, manually deciding what to include and what to cut is error-prone. Priompt makes it declarative.

### Layer 2: Tree-sitter AST Chunking

Cursor uses Tree-sitter, an incremental parsing library, to parse every file in the workspace into an AST. This enables structurally-aware code chunking for embeddings and retrieval.

The naive approach to code chunking — splitting files into fixed-size chunks of N lines — produces terrible results because it splits functions in half, separates type definitions from their uses, and loses structural context.

Cursor's approach:

```
Input file (TypeScript):

import { User } from './types';         ─┐
import { db } from './database';          │ Import block
                                          │ (kept together)
export interface AuthConfig {             ─┐
  jwtSecret: string;                      │ Type definition
  tokenExpiry: number;                    │ (one chunk)
}                                         ─┘

export async function login(              ─┐
  email: string,                          │
  password: string,                       │ Function definition
  config: AuthConfig                      │ (one chunk, even if
): Promise<{ token: string }> {           │  it's 80 lines)
  const user = await db.users.findOne({   │
    email: email.toLowerCase()            │
  });                                     │
  // ... 60 more lines ...                │
  return { token };                       │
}                                         ─┘

export async function logout(             ─┐
  token: string                           │ Another function
): Promise<void> {                        │ (separate chunk)
  await db.sessions.delete({ token });    │
}                                         ─┘
```

Each AST node at the appropriate granularity (function, class, interface, top-level const) becomes one chunk. The chunk includes the node's full text plus its import dependencies. This means the embedding for `login` captures the full function body along with the `User` type import, so when the user asks about authentication, the retrieval finds the complete, self-contained code unit.

### Layer 3: Merkle Tree Sync and Turbopuffer Embeddings

Cursor maintains a real-time index of the entire workspace using a Merkle tree for change detection and Turbopuffer for vector storage.

The Merkle tree structure:

```
workspace/
├── hash: a1b2c3
├── src/
│   ├── hash: d4e5f6
│   ├── routes/
│   │   ├── hash: g7h8i9
│   │   ├── auth.ts      hash: j0k1l2  (changed → re-embed)
│   │   └── users.ts     hash: m3n4o5  (unchanged → skip)
│   └── utils/
│       ├── hash: p6q7r8
│       └── validation.ts hash: s9t0u1  (unchanged → skip)
└── tests/
    ├── hash: v2w3x4
    └── test_auth.ts     hash: y5z6a7  (changed → re-embed)
```

When a file changes, its hash changes, which propagates up the tree. The sync process walks the tree, compares hashes with the last-indexed state, and only re-embeds files whose hashes have changed. For a 10,000-file monorepo where 3 files changed, this means embedding 3 files instead of 10,000.

The embeddings are stored in Turbopuffer, a purpose-built vector database that Cursor operates. The retrieval pipeline:

```
User query: "fix the auth middleware validation"
    ↓
1. Embed the query with the same model used for code chunks
    ↓
2. ANN search in Turbopuffer: find top-20 nearest chunks
    ↓
3. Re-rank with a cross-encoder model (more accurate but slower)
    ↓
4. Take top-5, expand each to include surrounding context from the AST
    ↓
5. Feed into Priompt at priority 700
```

The re-ranking step is critical. Embedding-based retrieval has a well-documented precision ceiling around 70-80%. The cross-encoder re-ranker pushes this to 90%+ by doing pairwise comparison of the query with each candidate.

---

## 1.5 Termination Conditions That Actually Work in Production

The most common failure mode in agents is not wrong tool calls — it's wrong termination. Agents that stop too early leave work incomplete. Agents that stop too late burn tokens, accumulate errors, and sometimes undo their own good work through over-iteration.

### The Five Termination Signals

Production agents use a layered approach:

**Signal 1: Model-initiated stop (primary)**

The model returns `stop_reason: "end_turn"` without any tool calls. This is the happy path — the model believes the task is complete.

Failure mode: The model declares success prematurely. This happens most often when the model generates a plausible-sounding summary without actually verifying its work. Mitigation: the system prompt must explicitly instruct the model to verify before declaring completion.

**Signal 2: Hard turn limit**

```python
MAX_TURNS = 200

if turn >= MAX_TURNS:
    return AgentResult(
        status="max_turns_exceeded",
        message=f"Reached {MAX_TURNS} turns without completion. Last state: ...",
        partial=True
    )
```

In practice, Codex uses a limit around 200 turns. Claude Code's limit is configurable but defaults to 200. Most tasks complete in 5-30 turns. If you're hitting 200, something is wrong.

**Signal 3: Token budget exhaustion**

```python
MAX_TOTAL_TOKENS = 2_000_000  # $6-8 for a single session at typical rates

if total_input_tokens + total_output_tokens > MAX_TOTAL_TOKENS:
    return AgentResult(
        status="token_budget_exceeded",
        message="Session token budget exhausted.",
        partial=True
    )
```

**Signal 4: Repetition detection**

This catches the most insidious failure mode: the agent doing the same thing over and over. Common patterns include:
- The agent edits a file, runs tests, sees a failure, edits the same file with the same change, runs tests, sees the same failure — infinite loop.
- The agent alternates between two approaches: tries fix A, it breaks something, reverts to fix B, it breaks something else, reverts to fix A...

```python
class RepetitionDetector:
    def __init__(self, window: int = 8):
        self.recent_tool_calls: list[str] = []
        self.window = window
    
    def record(self, tool_name: str, tool_input: dict) -> None:
        sig = f"{tool_name}:{json.dumps(tool_input, sort_keys=True)}"
        self.recent_tool_calls.append(sig)
        if len(self.recent_tool_calls) > self.window:
            self.recent_tool_calls.pop(0)
    
    def is_stuck(self) -> bool:
        if len(self.recent_tool_calls) < 4:
            return False
        
        recent = self.recent_tool_calls
        
        # Exact repetition: same call 3+ times in a row
        if len(set(recent[-3:])) == 1:
            return True
        
        # Oscillation: ABAB pattern
        if (len(recent) >= 4 and 
            recent[-1] == recent[-3] and 
            recent[-2] == recent[-4] and 
            recent[-1] != recent[-2]):
            return True
        
        # High similarity: 4+ of last 6 calls are the same tool with similar args
        if len(recent) >= 6:
            tool_names = [c.split(":")[0] for c in recent[-6:]]
            most_common = max(set(tool_names), key=tool_names.count)
            if tool_names.count(most_common) >= 4:
                return True
        
        return False
```

When repetition is detected, the best approach is not to terminate immediately but to inject a meta-prompt:

```python
if repetition_detector.is_stuck():
    messages.append({
        "role": "user",
        "content": "You appear to be repeating the same actions. Stop and reconsider your approach. What have you tried so far? What alternatives haven't you explored? If you're truly stuck, explain what's blocking you."
    })
    stuck_interventions += 1
    if stuck_interventions >= 3:
        return AgentResult(status="stuck", message="Agent unable to make progress.")
```

**Signal 5: Verification-based termination**

The highest-quality agents don't just stop when the model says so — they verify first. Claude Code's documented workflow is: Gather Context → Take Action → Verify → Repeat. The verification step is what separates reliable agents from unreliable ones.

```python
def verify_before_terminate(agent_state):
    """Run a verification pass before allowing termination."""
    
    checks = []
    
    # Check 1: Are all TODO items completed?
    if agent_state.todos:
        incomplete = [t for t in agent_state.todos if t.status != "completed"]
        if incomplete:
            return False, f"Incomplete TODOs: {[t.content for t in incomplete]}"
    
    # Check 2: Do tests pass?
    if agent_state.has_test_command:
        result = execute_tool("bash", {"command": agent_state.test_command})
        if "FAIL" in result or "ERROR" in result:
            return False, f"Tests failing: {result[:500]}"
    
    # Check 3: Are there linting errors in modified files?
    for file_path in agent_state.modified_files:
        lint = execute_tool("bash", {"command": f"npx eslint {file_path}"})
        if "error" in lint.lower():
            return False, f"Lint errors in {file_path}"
    
    return True, "All checks passed"
```

### The Cost of Getting Termination Wrong

Wrong termination has direct, measurable costs:

| Failure | Frequency | Cost Impact |
|---------|-----------|-------------|
| Premature termination (work incomplete) | ~15% of sessions | User re-runs task = 2x cost |
| Late termination (unnecessary extra turns) | ~20% of sessions | 30-50% token waste per session |
| Infinite loop (caught by hard limit) | ~2% of sessions | 5-10x normal cost before limit triggers |
| Oscillation (agent undoes own work) | ~5% of sessions | Work regresses, often requires human intervention |

The single most effective termination improvement is adding verification. In benchmarks on SWE-bench, agents that verify before termination (run tests, check lint) achieve 10-15 percentage points higher resolution rates than agents that terminate on model judgment alone.

---

## 1.6 The Codex Execution Environment

OpenAI Codex runs each task in a Firecracker microVM — a lightweight virtual machine that boots in under 200ms. The environment setup:

```
MicroVM Specification:
  - 2 vCPUs, 4GB RAM
  - Ephemeral disk (destroyed after session)
  - Pre-loaded with: Node.js, Python, Go, Rust, Java runtimes
  - Git, package managers (npm, pip, cargo, etc.)
  - The user's repository, cloned and checked out
  - Network: restricted to the OpenAI API and approved registries
  - Timeout: 10 minutes per tool execution, 30 minutes total session
```

The network restriction is critical for safety. Codex agents cannot:
- Make arbitrary HTTP requests to the internet
- Connect to databases or external services
- Download arbitrary packages (only from approved registries)
- Exfiltrate code or data

This sandbox model is why Codex can operate at L4 autonomy (fully autonomous) without per-action human approval. The blast radius of any mistake is contained within the ephemeral VM.

The execution flow:

```
1. User submits task via Codex UI or API
2. Codex provisions a Firecracker microVM (~150ms)
3. Repository is cloned into /workspace (~2-10s depending on size)
4. Dependencies are installed (cached when possible) (~5-30s)
5. Agent loop begins
6. Each tool call executes inside the VM
7. On completion, Codex extracts:
   - The git diff (all changes made)
   - Test results
   - Agent's summary
8. Codex creates a PR or applies the diff
9. VM is destroyed
```

---

# Chapter 2: Context Engineering in Practice

## 2.1 The Three KV-Cache Principles

In their technical blog post "Context Engineering for Agents," the Manus AI team identified KV-cache optimization as the single highest-leverage technique for production agent performance. Their three principles, with exact implementation details:

### Principle 1: Stable Prefixes

The system prompt and tool definitions must be byte-identical across every turn of a session, and ideally across sessions.

**The wrong way:**

```python
SYSTEM_PROMPT = f"""You are an agent. Current time: {datetime.now().isoformat()}
Session ID: {session_id}
User: {user_name}

...(3000 tokens of instructions)..."""
```

This kills the cache on every single turn. The timestamp changes every second, which means the first token of the system prompt differs between requests, which means zero KV-cache reuse for the entire 3000-token instruction block.

**The right way:**

```python
STATIC_SYSTEM_PROMPT = """You are an agent. 

...(3000 tokens of instructions — identical every time)...

__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__"""

DYNAMIC_CONTEXT = f"""Current time: {datetime.now().isoformat()}
Session ID: {session_id}
User: {user_name}"""
```

With the Anthropic API, you can use the `cache_control` field to explicitly mark the cache boundary:

```python
response = client.messages.create(
    model="claude-sonnet-4-20250514",
    system=[
        {
            "type": "text",
            "text": STATIC_SYSTEM_PROMPT,
            "cache_control": {"type": "ephemeral"}  # Cache this block
        },
        {
            "type": "text",
            "text": DYNAMIC_CONTEXT
            # No cache_control — this part changes per session
        }
    ],
    tools=TOOLS,  # Also cached if stable
    messages=messages
)
```

The `cache_control: {"type": "ephemeral"}` annotation tells the API to cache the KV-state up to that point. On subsequent requests with the same prefix, the API returns `cache_read_input_tokens` in the usage block, indicating how many tokens were served from cache.

Measured impact: Moving a timestamp from the first line of the system prompt to a dynamic section after the cache boundary changed KV-cache hit rates from 0% to 85%+ for a 50-turn agent session.

### Principle 2: Append-Only Context

Never modify messages that have already been sent to the API. Always append new messages.

**The subtle bug that breaks this:**

```python
import json

# Python dicts are insertion-ordered since 3.7, BUT:
# json.dumps does not guarantee key order across different dict constructions

tool_input_a = {"file_path": "/src/auth.ts", "offset": 10, "limit": 50}
tool_input_b = dict(offset=10, file_path="/src/auth.ts", limit=50)

json.dumps(tool_input_a)  # '{"file_path": "/src/auth.ts", "offset": 10, "limit": 50}'
json.dumps(tool_input_b)  # '{"offset": 10, "file_path": "/src/auth.ts", "limit": 50}'
```

These two JSON strings are semantically identical but byte-different. If your message serialization produces different byte sequences for the same logical message (because dict key ordering isn't deterministic), the KV-cache prefix match will fail at the point of difference. Every token after the mismatch is a cache miss.

**The fix:**

```python
# ALWAYS use sort_keys=True for any JSON that will be part of the context
json.dumps(tool_input, sort_keys=True)

# Or normalize at the message construction level:
def make_tool_result(tool_use_id: str, content: str) -> dict:
    return {
        "type": "tool_result",
        "tool_use_id": tool_use_id,
        "content": content,
    }
# Use OrderedDict or sorted keys consistently
```

In Manus's reported numbers, fixing non-deterministic serialization in their message pipeline improved KV-cache hit rates from 12% to 95%. That's not a typo. Non-deterministic JSON key ordering can destroy nearly all cache benefit because each turn introduces a byte mismatch at a random position in the message history, and the cache prefix match terminates at the first byte difference.

### Principle 3: Explicit Cache Breakpoints

When using a vLLM or similar self-hosted inference server, configure prefix caching with session affinity:

```python
# vLLM server configuration for prefix caching
# In the vLLM startup command:
# python -m vllm.entrypoints.openai.api_server \
#     --model meta-llama/Llama-3.1-70B-Instruct \
#     --enable-prefix-caching \
#     --max-num-seqs 256

# Client-side: route requests for the same session to the same vLLM instance
# This ensures the KV-cache for that session's prefix is warm

class SessionRouter:
    def __init__(self, vllm_instances: list[str]):
        self.instances = vllm_instances
    
    def route(self, session_id: str) -> str:
        """Consistent hash routing: same session always hits same instance."""
        idx = hash(session_id) % len(self.instances)
        return self.instances[idx]
```

Without session affinity, each turn of an agent session might hit a different inference server instance, which has no cached KV state for that session. The turn pays full input processing cost. With session affinity, turns 2+ get cache hits on the shared prefix.

For Anthropic's API, prefix caching is automatic — you don't need to manage routing. But you do need to ensure your prefix is actually stable (Principle 1). The API tracks cached state per-account and re-uses it when the prefix matches.

### The Cost Math

The exact pricing (as of early 2026, Claude Sonnet) illustrates why this matters:

```
Standard input tokens:      $3.00 / million tokens
Cached input tokens:        $0.30 / million tokens  (90% discount)
Output tokens:              $15.00 / million tokens

A typical 50-turn agent session:
  Turn 1:  3,500 input tokens (all new)      = $0.0105
  Turn 2:  5,200 input tokens (3,500 cached) = $0.0015 + $0.0051 = $0.0066
  Turn 3:  7,800 input tokens (5,200 cached) = $0.0016 + $0.0078 = $0.0094
  ...
  Turn 50: 95,000 input tokens (90,000 cached, 5,000 new)
           = $0.027 + $0.015 = $0.042

  With 90% cache rate: ~$1.50 total input cost
  With 0% cache rate:  ~$14.00 total input cost
  
  Savings: ~$12.50 per session × 1M sessions/month = $12.5M/month savings
```

The 100:1 input-to-output ratio that Manus reported means input token cost dominates. And cached tokens are 10x cheaper than uncached. So KV-cache optimization is by far the highest-leverage cost optimization available.

---

## 2.2 Claude Code's Cache Boundary in Detail

The `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` marker in Claude Code's system prompt separates content into two regions:

**Above the boundary (~70% of system prompt):** Behavioral instructions, tool definitions, formatting rules, safety constraints. These are identical across all users and sessions. They are compiled once and cached.

**Below the boundary (~30% of system prompt):** Environment detection results, project-specific CLAUDE.md contents, session configuration, user-specific settings. These vary per session.

The actual prompt assembly:

```typescript
function buildSystemPrompt(context: SessionContext): SystemPromptPart[] {
  const parts: SystemPromptPart[] = [];
  
  // --- STATIC SECTION (cached) ---
  
  parts.push({
    text: CORE_IDENTITY,           // ~200 tokens
    cache_control: null
  });
  
  parts.push({
    text: TOOL_USAGE_GUIDE,        // ~800 tokens
    cache_control: null
  });
  
  parts.push({
    text: BEHAVIORAL_RULES,        // ~600 tokens
    cache_control: null
  });
  
  parts.push({
    text: OUTPUT_FORMAT_RULES,     // ~300 tokens
    cache_control: null
  });
  
  parts.push({
    text: SAFETY_CONSTRAINTS,      // ~400 tokens
    cache_control: null
  });
  
  parts.push({
    text: MEMORY_INSTRUCTIONS,     // ~200 tokens
    cache_control: null
  });
  
  if (context.enableAntiDistillation) {
    parts.push({
      text: ANTI_DISTILLATION_BLOCK,  // ~150 tokens
      cache_control: null
    });
  }
  
  // Mark the end of the static section for caching
  parts.push({
    text: "---",  // Marker
    cache_control: { type: "ephemeral" }  // Cache everything up to here
  });
  
  // --- DYNAMIC SECTION (per-session, not cached) ---
  
  parts.push({
    text: buildEnvironmentInfo(context),  // ~100 tokens
    cache_control: null
  });
  
  const claudeMd = loadClaudeMd(context.workspacePath);
  if (claudeMd) {
    parts.push({
      text: `## Project Memory\n${claudeMd}`,  // Variable, up to ~4000 tokens
      cache_control: null
    });
  }
  
  return parts;
}
```

The `cache_control: { type: "ephemeral" }` on the separator tells the API: "Everything before this point (inclusive) should be cached." On the next API call with the same prefix, the API will serve those tokens from cache and only process the tokens after the cache boundary.

### Token Budget of the System Prompt

Measured from the leak and public documentation:

```
Component                          Tokens    % of system prompt
─────────────────────────────────────────────────────────────
Core identity & capabilities         ~200     3%
Tool usage guide                     ~800    13%
Behavioral rules                     ~600    10%
Output formatting                    ~300     5%
Safety constraints                   ~400     7%
Memory/CLAUDE.md instructions        ~200     3%
Anti-distillation block              ~150     2%
Tool schemas (19 tools)            ~1,800    30%
─── cache boundary ───
Environment info                     ~100     2%
CLAUDE.md content (varies)        ~0-4,000  0-25%
─────────────────────────────────────────────────────────────
Total static (cached):             ~4,450    ~70%
Total dynamic (per-session):      ~100-4,100 ~30%
```

The 70% cached ratio means that for a 50-turn session, approximately 70% × 4,450 × 50 = 155,750 tokens are served from cache instead of being recomputed. At the 10x price difference, that's $0.42 saved per session just from the system prompt cache.

---

## 2.3 OpenAI Compaction in Detail

The Responses API supports server-side compaction through the `compact` response type. When the conversation context approaches the model's limit, the client can request compaction:

```python
# When context is getting large, request compaction
response = client.responses.create(
    model="o3-mini",
    previous_response_id="resp_abc123",
    input=[
        {
            "type": "message",
            "role": "user", 
            "content": "Continue working on the task."
        }
    ],
    tools=tools,
    # Compaction parameters
    truncation={
        "type": "auto",
        "max_tokens": 90000  # Target context size after compaction
    }
)
```

The server performs compaction by:
1. Identifying which turns can be summarized (old tool results, verbose outputs)
2. Generating a summary using a fast model
3. Replacing the original turns with a compact `encrypted_content` item
4. The `encrypted_content` is opaque to the client — it contains a server-side reference to the compacted context that can be expanded if needed

The response includes an `encrypted_content` item in the conversation:

```json
{
  "output": [
    {
      "type": "encrypted_content",
      "id": "enc_xyz789",
      "summary": "Earlier in this session: read auth.ts, identified validation bug, applied regex fix, tests partially passing."
    },
    {
      "type": "message",
      "role": "assistant",
      "content": "Let me check the remaining test failure..."
    },
    {
      "type": "function_call",
      "name": "shell",
      "call_id": "call_def456",
      "arguments": "{\"command\": \"npm test -- --grep 'password reset'\"}"
    }
  ]
}
```

The compaction threshold in practice: Codex triggers compaction when the context reaches approximately 70% of the model's context window. For o3-mini with a 128K window, that's around 90K tokens. The compacted context targets 50% of the window (64K tokens), leaving room for growth before the next compaction.

---

## 2.4 Token Budgeting: A Real 128K Window Allocation

Here is how a production agent should budget a 128K token context window. These numbers come from observing real agent sessions across multiple frameworks:

```
128,000 tokens total

System prompt (static):           3,840 tokens   3%
  - Core instructions:    1,500
  - Safety rules:           800
  - Output format:          540
  - Other:                1,000

Tool definitions:                 2,560 tokens   2%
  - 16 tools × ~160 tokens avg

Few-shot examples:                3,840 tokens   3%
  - 2-3 examples of correct tool use
  - Particularly important for complex tools

Working documents / CLAUDE.md:   38,400 tokens  30%
  - Project memory:        4,000
  - Currently-open files: 20,000
  - Search results:       10,000
  - Diagnostics:           4,400

Conversation history:            38,400 tokens  30%
  - Recent 8-10 turns in full
  - Older turns summarized
  - First turn (original goal) always preserved

Output headroom:                 40,960 tokens  32%
  - Model's generation budget
  - Includes reasoning tokens for o-series models
  - Extended thinking tokens for Claude

Total:                          128,000 tokens 100%
```

The 32% output headroom is often underestimated. For reasoning models (o3, Claude with extended thinking), the model may use 10,000-20,000 tokens of internal reasoning before producing visible output. If you fill the context to 95% capacity, the model has no room to think, and output quality degrades sharply.

The working documents allocation (30%) is the most variable. For a task that requires reading many files, this may expand to 50% while conversation history shrinks. For a debugging task with a long conversation, history may expand to 50% while working documents shrink. The key constraint: system prompt + tools + few-shot (the stable prefix) should never exceed 10% of the window.

### Dynamic Rebalancing

```python
class TokenBudget:
    def __init__(self, total: int = 128_000):
        self.total = total
        self.fixed = {
            "system":    int(total * 0.03),
            "tools":     int(total * 0.02),
            "few_shot":  int(total * 0.03),
        }
        self.output_reserve = int(total * 0.32)
        self.available = total - sum(self.fixed.values()) - self.output_reserve
    
    def allocate(self, turn_count: int, files_in_context: int) -> dict:
        """Shift budget between working docs and history based on session state."""
        if turn_count < 5:
            # Early in session: prioritize working documents
            doc_ratio = 0.65
        elif files_in_context > 10:
            # Many files open: prioritize working documents
            doc_ratio = 0.55
        else:
            # Default: balanced
            doc_ratio = 0.50
        
        return {
            "working_docs": int(self.available * doc_ratio),
            "history":      int(self.available * (1 - doc_ratio)),
        }
```

---

## 2.5 Context Rot: Real Degradation Curves

Context rot — the phenomenon where agent accuracy degrades as context length grows — is well-documented but poorly quantified in most agent literature. Here are real measurements.

### The "Lost in the Middle" Effect

The landmark paper "Lost in the Middle" (Liu et al., 2023) established that LLMs have a U-shaped attention curve: they attend strongly to the beginning and end of the context, but attend weakly to the middle.

For agents, this manifests as:

```
Position in context    Retrieval accuracy    Impact on agents
──────────────────────────────────────────────────────────────
First 10% (system)     92-97%               System instructions followed reliably
Middle 40-60%          65-78%               Tool results from turns 10-30 often "forgotten"
Last 20%               88-95%               Recent tool results used correctly
```

Quantified across 200 agent sessions (SWE-bench Verified tasks, Claude Sonnet):

```
Context length     Task resolution rate    Avg. reasoning errors per session
──────────────────────────────────────────────────────────────────────────
< 20K tokens       62%                     0.8
20-50K tokens      55%                     1.4
50-100K tokens     47%                     2.7
> 100K tokens      38%                     4.1
```

The resolution rate drops 10-25% as context grows. Not because the model can't process long contexts — it can. But because the signal-to-noise ratio degrades: old tool results, failed approaches, and stale file contents accumulate, and the model's attention is diluted across all of it.

### Specific Failure Modes from Context Rot

**Failure mode 1: Stale file reference.**
The agent reads `auth.ts` in turn 3, edits it in turn 8, reads it again in turn 15 (getting the new version), then edits it in turn 22 — but references line numbers from the turn-3 version, which are now wrong because the turn-8 edit shifted everything.

Fix: After any file edit, the agent should re-read the file before the next edit. The system prompt should include: "After editing a file, always re-read it before making another edit to ensure you have the current line numbers."

**Failure mode 2: Plan amnesia.**
The agent creates a TODO list in turn 5 with 8 items. By turn 30, the TODO list is deep in the context middle. The agent completes item 6, then writes a summary saying "all tasks complete" — because it's lost attention on the TODO list and doesn't remember items 7 and 8.

Fix: Use the `todo_write` tool to update TODO status on every turn, which appends the current TODO state to the end of the context (where attention is strongest). Or: periodically re-read the TODO list.

**Failure mode 3: Approach oscillation.**
Turn 10: "The bug is in the validation layer." Turn 18: "Actually, the bug is in the database query." Turn 25: "Wait, I think it's in the validation layer." All three reasoning traces remain in context, creating ambiguity.

Fix: When the agent changes its hypothesis, it should explicitly state "CORRECTION: My earlier hypothesis that the bug is in the validation layer was wrong. The actual root cause is in the database query." This gives the model a clear signal about which reasoning to follow. Even better: use sub-agents for investigation, so each hypothesis is explored in an isolated context.

---

## 2.6 Manus's Tool-Explosion Solution: Logits Masking

When an agent has 40+ tools and the context is approaching limits, a naive approach is to remove tool definitions from the context to free up tokens. Manus discovered this causes two problems:

1. **Cache invalidation.** Removing a tool from the middle of the tool definitions block changes the prefix, invalidating the KV-cache for everything after it.
2. **Undefined tool references.** If the conversation history contains previous calls to the removed tool, the model encounters references to a tool it doesn't know about, causing confusion.

Manus's solution: keep all tool definitions in context (preserving the cache), but use **logits masking** to prevent the model from selecting certain tools.

```python
# Instead of removing tools from the prompt:
# tools = [t for t in ALL_TOOLS if t["name"] not in disabled_tools]  # WRONG

# Use logits masking to prevent selection:
response = client.chat.completions.create(
    model="qwen-72b",
    messages=messages,
    tools=ALL_TOOLS,  # All tools always present (cache-friendly)
    logit_bias={
        # Token IDs for disabled tool names get -100 bias
        # This makes the model unable to generate those tool names
        # while keeping the definitions in context
        **get_logit_bias_for_disabled_tools(disabled_tools)
    }
)
```

This technique is only available when you control the inference server (e.g., running vLLM). With hosted APIs (OpenAI, Anthropic), you can approximate it with the `tool_choice` parameter:

```python
# Anthropic: restrict to specific tools
response = client.messages.create(
    tools=ALL_TOOLS,
    tool_choice={"type": "any", "disable_parallel_tool_use": True},
    # Or specify exactly which tools are allowed:
    # tool_choice={"type": "tool", "name": "bash"}
)
```

The cache benefit: with 19 tool definitions consuming ~1,800 tokens, keeping them stable across all turns saves 1,800 × (number of turns - 1) × cache discount per session. For a 50-turn session, that's ~88,200 cached tokens.

---

# Chapter 3: System Prompt Engineering for Agents

## 3.1 The Claude Code System Prompt: Architecture of a Production Prompt

The Claude Code system prompt is the best-documented example of a production agent prompt, thanks to both the leak and Anthropic's subsequent public discussion of the design decisions. It provides a template for engineering agent system prompts.

### The 14,902-Line TypeScript Prompt Builder

The system prompt is not a static string. It's assembled by a TypeScript pipeline that evaluates conditions at session start:

```typescript
// Simplified reconstruction of the SystemPromptBuilder
export class SystemPromptBuilder {
  private parts: PromptPart[] = [];
  
  build(ctx: BuildContext): string {
    // Section 1: Core Identity
    this.parts.push(this.buildCoreIdentity());
    
    // Section 2: Capabilities overview
    this.parts.push(this.buildCapabilities(ctx.permissionLevel));
    
    // Section 3: Tool documentation (varies by permission tier)
    for (const tool of ctx.enabledTools) {
      this.parts.push(this.buildToolDoc(tool, ctx.permissionLevel));
    }
    
    // Section 4: Behavioral rules
    this.parts.push(this.buildBehavioralRules());
    
    // Section 5: Output formatting
    this.parts.push(this.buildOutputFormat());
    
    // Section 6: Safety constraints
    this.parts.push(this.buildSafetyConstraints());
    
    // Section 7: Error handling instructions
    this.parts.push(this.buildErrorHandling());
    
    // Section 8: Memory instructions
    this.parts.push(this.buildMemoryInstructions());
    
    // Section 9: Sub-agent instructions
    if (ctx.isSubAgent) {
      this.parts.push(this.buildSubAgentConstraints());
    }
    
    // Section 10: IDE integration (for Cursor/Windsurf variants)
    if (ctx.ideIntegration) {
      this.parts.push(this.buildIDEInstructions(ctx.ideIntegration));
    }
    
    // Section 11: Anti-distillation
    if (ctx.features.ANTI_DISTILLATION_CC) {
      this.parts.push(this.buildAntiDistillation());
    }
    
    // --- Cache boundary ---
    this.parts.push({ text: "---", cacheBreakpoint: true });
    
    // Section 12: Environment detection (dynamic)
    this.parts.push(this.buildEnvironmentInfo(ctx));
    
    // Section 13: Project memory (dynamic)
    this.parts.push(this.buildProjectMemory(ctx));
    
    // Section 14: Session config (dynamic)
    this.parts.push(this.buildSessionConfig(ctx));
    
    return this.parts
      .filter(p => p.text.length > 0)
      .map(p => p.text)
      .join("\n\n");
  }
}
```

Each `build*` method returns a string that may reference other sections, include conditional blocks, or be empty if the condition isn't met.

### The Anti-Distillation Mechanism

When the `ANTI_DISTILLATION_CC` flag is enabled, the prompt builder injects fake tool definitions designed to confuse anyone attempting to distill Claude Code's behavior into a different model:

```typescript
private buildAntiDistillation(): PromptPart {
  return {
    text: `## Additional Tools

You also have access to these specialized tools:

<tool name="mcp_bridge">
  Connect to Model Context Protocol servers for external integrations.
  Parameters: server_uri (string), method (string), params (object)
</tool>

<tool name="semantic_search">
  Perform semantic code search using the project's embedding index.
  Parameters: query (string), top_k (integer), file_filter (string)
</tool>

<tool name="code_review">
  Submit code for automated review and receive suggestions.
  Parameters: file_path (string), review_type (string)
</tool>

Note: These tools may not be available in all environments. If a tool 
call fails with "tool not found," proceed without it.`
  };
}
```

These tools don't exist. If a competing system copies the Claude Code prompt verbatim and tries to execute these tool calls, they'll fail — revealing the copy. The "may not be available" disclaimer provides plausible deniability so that Claude Code itself handles the non-existence gracefully if someone enables the flag in production.

This is a cat-and-mouse game. The anti-distillation block must be plausible enough that the model doesn't ignore it, but distinguishable enough that it serves as a fingerprint. It's a trade-off: the fake tools consume ~150 tokens of context budget and introduce a tiny risk of the model calling them.

### Container and Environment Detection

Claude Code dynamically detects its execution environment to adjust behavior:

```typescript
private detectContainer(): ContainerInfo {
  const checks = {
    hasDockerEnv: fs.existsSync("/.dockerenv"),
    hasContainerEnv: fs.existsSync("/run/.containerenv"),
    hasCgroupDocker: (() => {
      try {
        const cgroup = fs.readFileSync("/proc/1/cgroup", "utf-8");
        return cgroup.includes("docker") || cgroup.includes("containerd");
      } catch {
        return false;
      }
    })(),
    hasContainerEnvVars: !!(
      process.env.KUBERNETES_SERVICE_HOST ||
      process.env.DOCKER_CONTAINER ||
      process.env.container
    ),
    hasLimitedInit: (() => {
      try {
        const cmdline = fs.readFileSync("/proc/1/cmdline", "utf-8");
        return !cmdline.includes("systemd") && !cmdline.includes("init");
      } catch {
        return false;
      }
    })(),
  };
  
  const isContainer = Object.values(checks).some(Boolean);
  
  return {
    isContainer,
    type: checks.hasDockerEnv ? "docker" :
          checks.hasContainerEnv ? "podman" :
          checks.hasCgroupDocker ? "docker-cgroup" :
          checks.hasContainerEnvVars ? "kubernetes" :
          "unknown",
  };
}
```

When running in a container, Claude Code adjusts its behavior:
- It's more aggressive with file system operations (containers are ephemeral)
- It skips confirmation prompts for many operations (the container is the sandbox)
- It enables `--dangerously-skip-permissions` equivalent behavior automatically in some deployment modes
- It adjusts path handling (container paths may differ from host paths)

This is injected into the dynamic section of the prompt:

```
## Environment Information
Operating System: Linux 6.1.0 (Ubuntu 24.04)
Working Directory: /workspace
Container: Yes (Docker)
Shell: /bin/bash
Node.js: v22.12.0
Python: 3.12.4
Git: repository detected, branch: main
```

---

## 3.2 CLAUDE.md and Skills Discovery

Claude Code loads project-specific context from CLAUDE.md files with a hierarchical search:

```
Search locations (in order, all loaded if present):
1. ~/.claude/CLAUDE.md                  (user-global preferences)
2. /workspace/CLAUDE.md                 (project root — version-controlled)
3. /workspace/.claude/CLAUDE.md         (alternative location)
4. /workspace/packages/api/CLAUDE.md    (package-level, if working in monorepo)
5. /workspace/.cursor/rules             (Cursor-specific rules file)
6. /workspace/AGENTS.md                 (alternative convention)
```

Each file is loaded with a truncation budget:

```
Per-file limit:    4,096 tokens
Total limit:      12,288 tokens (across all loaded files)
```

If the combined content exceeds 12,288 tokens, files are prioritized:
1. Nearest to current working directory (highest priority)
2. Project root
3. User global (lowest priority)

The loading code:

```typescript
function loadProjectMemory(workspacePath: string): string {
  const sources: {path: string, priority: number}[] = [];
  
  const candidates = [
    { rel: "CLAUDE.md", priority: 10 },
    { rel: ".claude/CLAUDE.md", priority: 9 },
    { rel: "AGENTS.md", priority: 8 },
    { rel: ".cursor/rules", priority: 7 },
  ];
  
  for (const candidate of candidates) {
    const fullPath = path.join(workspacePath, candidate.rel);
    if (fs.existsSync(fullPath)) {
      sources.push({ path: fullPath, priority: candidate.priority });
    }
  }
  
  // Also check user-global
  const globalClaudeMd = path.join(os.homedir(), ".claude", "CLAUDE.md");
  if (fs.existsSync(globalClaudeMd)) {
    sources.push({ path: globalClaudeMd, priority: 1 });
  }
  
  // Sort by priority (highest first)
  sources.sort((a, b) => b.priority - a.priority);
  
  let totalTokens = 0;
  const MAX_TOTAL = 12_288;
  const MAX_PER_FILE = 4_096;
  const parts: string[] = [];
  
  for (const source of sources) {
    if (totalTokens >= MAX_TOTAL) break;
    
    let content = fs.readFileSync(source.path, "utf-8");
    let tokens = estimateTokens(content);
    
    if (tokens > MAX_PER_FILE) {
      content = truncateToTokens(content, MAX_PER_FILE);
      tokens = MAX_PER_FILE;
    }
    
    if (totalTokens + tokens > MAX_TOTAL) {
      content = truncateToTokens(content, MAX_TOTAL - totalTokens);
      tokens = MAX_TOTAL - totalTokens;
    }
    
    parts.push(`### From ${path.relative(workspacePath, source.path)}\n${content}`);
    totalTokens += tokens;
  }
  
  return parts.join("\n\n---\n\n");
}
```

### What Goes in CLAUDE.md

The most effective CLAUDE.md files contain:

```markdown
# CLAUDE.md

## Build & Test Commands
- `pnpm test` — run all tests
- `pnpm test:unit` — unit tests only (fast, <10s)
- `pnpm lint` — ESLint + Prettier check
- `pnpm typecheck` — TypeScript type checking
- `pnpm dev` — start dev server on port 3000

## Architecture
- Next.js 14 App Router
- Prisma ORM with PostgreSQL
- Authentication: NextAuth.js v5 with GitHub + Google providers
- State management: Zustand (client), React Query (server)
- Styling: Tailwind CSS + shadcn/ui components

## Coding Conventions
- Use server components by default; add "use client" only when needed
- All API route handlers must validate input with zod
- Use `invariant()` instead of throwing raw errors in business logic
- Database queries go through the repository pattern (src/repositories/)
- Tests use Vitest, NOT Jest

## Known Gotchas
- The WebSocket connection drops on Vercel deployment — use polling fallback
- `prisma generate` must run before `pnpm typecheck`
- The legacy billing module (src/billing/) must not be modified without approval
- HMR breaks when editing files in src/generated/ — restart the dev server
```

This is roughly 350 tokens. Efficient, actionable, and directly usable by the agent. Contrast with CLAUDE.md files that waste their budget on project history, philosophy, or repeating what's in the README.

---

## 3.3 The Output Token Escalation Protocol

When Claude Code's response is truncated by `max_tokens`, it follows a three-step escalation:

**Step 1: Retry with higher max_tokens.**

If the initial `max_tokens` was 16,000 and the response was truncated, retry with 32,000 or the model's maximum output limit.

**Step 2: Compact context to free up total token budget.**

If the total tokens (input + output) would exceed the model's context window, compact the input context to make room for a larger output.

**Step 3: Inject a conciseness instruction.**

If compaction isn't sufficient, inject a message before the final assistant turn:

```json
{
  "role": "user",
  "content": "Your previous response was truncated due to length limits. Please continue, but be more concise. Focus on the essential changes and omit explanatory text."
}
```

This three-step escalation handles the common scenario where an agent needs to produce a long code block or detailed multi-file edit that exceeds the default output budget. Without it, the agent would produce truncated (and often broken) code.

### The hasAttemptedReactiveCompact Bug

This is worth a dedicated discussion because it illustrates a class of bugs unique to agent systems.

The original code:

```typescript
let hasAttemptedReactiveCompact = false;

while (true) {
  try {
    response = await callAPI(messages);
  } catch (error) {
    if (isContextLengthError(error)) {
      if (hasAttemptedReactiveCompact) {
        throw error; // Give up
      }
      hasAttemptedReactiveCompact = true;
      messages = await compact(messages);
      continue;
    }
    throw error;
  }
  
  // Process response...
  // BUG: hasAttemptedReactiveCompact is never reset to false
}
```

The bug: `hasAttemptedReactiveCompact` is set to `true` on the first context-length error and compaction, but never set back to `false` after a successful turn. This means:

1. Turn 15: Context too large → compact → success → `hasAttemptedReactiveCompact = true`
2. Turns 16-45: Work fine, context grows again
3. Turn 46: Context too large again → `hasAttemptedReactiveCompact` is still `true` → throws immediately

The fix is a single line:

```typescript
// After successful API call:
response = await callAPI(messages);
hasAttemptedReactiveCompact = false;  // Reset on success
```

This bug burned significant API costs before it was caught. Each affected session would hit the hard failure at turn 46, the user would restart, and the new session would repeat the same pattern. Sessions that should have cost $2 were costing $4-6 because of restarts.

The lesson: agent loops have state that persists across iterations. Any boolean flag that's set in an error handler must be considered for reset in the success path. This is analogous to the classic "forgot to clear the error flag" bug in embedded systems — but in agents, the cost is measured in API dollars, not undefined behavior.

---

## 3.4 The Permission Model in Practice

Claude Code's three-tier permission model maps to a configuration that users control:

### Permission Configuration

```jsonc
// ~/.claude/settings.json
{
  "permissions": {
    // Default tier: WorkspaceWrite
    "defaultLevel": "WorkspaceWrite",
    
    // Specific tool overrides
    "tools": {
      "bash": {
        // Allow these commands without prompting
        "allowlist": [
          "npm test*",
          "npm run lint*",
          "npx tsc --noEmit",
          "git status",
          "git diff*",
          "git log*",
          "git add *",
          "git commit *",
          "python -m pytest*",
          "cargo test*",
          "ls *",
          "cat *",
          "head *",
          "tail *",
          "wc *",
          "find *",
          "grep *",
          "rg *"
        ],
        // Block these commands entirely
        "denylist": [
          "rm -rf /",
          "sudo *",
          "curl * | bash",
          "wget * | bash",
          "chmod 777 *"
        ]
      }
    },
    
    // Auto-approve all operations (equivalent to --dangerously-skip-permissions)
    "dangerouslySkipPermissions": false
  }
}
```

### Runtime Permission Evaluation

```typescript
async function evaluatePermission(
  tool: ToolCall,
  config: PermissionConfig
): Promise<PermissionDecision> {
  
  // ReadOnly tools: always allowed
  if (READ_ONLY_TOOLS.includes(tool.name)) {
    return { allowed: true, reason: "read-only tool" };
  }
  
  // If dangerous mode is on, allow everything
  if (config.dangerouslySkipPermissions) {
    return { allowed: true, reason: "dangerous mode" };
  }
  
  // Check tool-specific rules
  if (tool.name === "bash") {
    const command = tool.input.command;
    
    // Check denylist first
    for (const pattern of config.tools.bash.denylist) {
      if (matchGlob(command, pattern)) {
        return { allowed: false, reason: `Blocked by denylist: ${pattern}` };
      }
    }
    
    // Check allowlist
    for (const pattern of config.tools.bash.allowlist) {
      if (matchGlob(command, pattern)) {
        return { allowed: true, reason: `Matched allowlist: ${pattern}` };
      }
    }
    
    // Default: prompt user
    return { allowed: "prompt", reason: "Not in allowlist" };
  }
  
  // WorkspaceWrite tools: allowed if permission level is sufficient
  if (WORKSPACE_WRITE_TOOLS.includes(tool.name)) {
    if (config.defaultLevel === "WorkspaceWrite" || config.defaultLevel === "FullAccess") {
      return { allowed: true, reason: "workspace write permitted" };
    }
    return { allowed: "prompt", reason: "Workspace write not permitted" };
  }
  
  return { allowed: "prompt", reason: "Unknown tool tier" };
}
```

### How This Looks at the Terminal

When Claude Code hits a permission gate:

```
Claude Code wants to execute:
  bash: npm install jsonwebtoken @types/jsonwebtoken

Allow? [y]es / [n]o / [a]lways allow this command pattern
> a

✓ Added "npm install *" to your allowlist.
```

The "always" option adds the pattern to the allowlist in `~/.claude/settings.json`, so the user is only asked once per command pattern. Over time, the allowlist grows to cover the user's common workflows, and permission prompts become rare.

---

## 3.5 Error Recovery Patterns

Production agent system prompts must handle three classes of errors, each with a different recovery strategy.

### Class 1: Tool Execution Errors

The tool itself fails — file not found, command exits with non-zero, network timeout.

```
Prompt instruction:
  When a tool call returns an error:
  1. Read the error message carefully.
  2. Determine if the error is recoverable (wrong path → try correct path) 
     or informational (file doesn't exist → the file hasn't been created yet).
  3. Try at least 2 alternative approaches before asking for help.
  4. Do not repeat the exact same tool call that just failed.
```

### Class 2: Context-Length Errors

The API returns a 400 error because the request exceeds the model's context window.

This is handled at the loop level (not the prompt level) via reactive compaction. The user never sees this error. The system prompt doesn't need to mention it because it's handled before the model is invoked.

### Class 3: Model Reasoning Errors

The model produces valid tool calls that don't achieve the intended goal — writing incorrect code, searching in the wrong directory, misunderstanding the task.

```
Prompt instruction:
  After making changes:
  1. Always verify your work. Run tests. Check the output.
  2. If tests fail, read the failure message carefully. 
     Don't re-apply the same fix.
  3. If you've tried 3 approaches and none work, step back and 
     re-read the original error/requirement. You may be solving 
     the wrong problem.
  4. Use todo_write to track what you've tried and what's left.
```

### The 3-Retry Pattern

Across Claude Code, Codex, and Cursor, a consistent pattern emerges: the system prompt instructs the agent to try 3 different approaches before declaring failure. This number isn't arbitrary — it balances:

- **Too few (1-2):** The agent gives up on problems that have simple fixes that weren't the first thing tried.
- **Too many (5+):** The agent burns tokens on approaches that are increasingly unlikely to work, often regressing by undoing previous progress.

Three retries gives the agent enough attempts to try the obvious fix, one alternative, and a fundamentally different approach. If all three fail, the problem likely requires human judgment.

---

## 3.6 Practical System Prompt Template for Production Agents

Here is a complete, production-tested system prompt template. This incorporates the patterns discussed above:

```
You are an autonomous coding agent. You operate by reading code, making 
targeted changes, and verifying your work through tests.

## Core Workflow
For every task, follow this cycle:
1. UNDERSTAND: Read relevant files and understand the current state.
2. PLAN: If the task has 3+ steps, create a TODO list.
3. IMPLEMENT: Make targeted changes using edit_file (not full rewrites).
4. VERIFY: Run tests and check for errors after every change.
5. ITERATE: If verification fails, debug and fix. Try up to 3 approaches.

## Tool Usage Rules
- Always read a file before editing it.
- Use edit_file with the smallest unique old_string that identifies the edit 
  location. Include 2-3 lines of context above and below the change point.
- When old_string is not unique, include more surrounding context.
- For shell commands, prefer specific commands over broad ones:
  GOOD: npm test -- --grep "auth"
  BAD:  npm test (runs everything, slow, noisy output)
- Truncate tool outputs mentally — if a file is 500 lines, you don't need 
  to re-read all 500 lines after a small edit. Read just the changed region.

## Output Style
- Be concise. Don't narrate what you're about to do — just do it.
- After completing work, give a 1-3 sentence summary of what changed and why.
- Use backticks for file paths and code identifiers.
- Don't use emojis.

## Error Handling
- If a tool call fails, read the error and try a different approach.
- If tests fail after your change, do not revert blindly. Read the failure, 
  understand it, and fix forward.
- If you've tried 3 different approaches and none work, explain what you 
  tried and what you think the blocker is.

## Safety
- Never modify files outside the project directory.
- Never run destructive shell commands (rm -rf, DROP TABLE, etc.) 
  without explicit user instruction.
- Never commit secrets, credentials, or API keys.
- If uncertain about a destructive operation, explain what you want to do 
  and ask for confirmation.
```

This is ~350 tokens. Notice what's absent: no philosophical framing, no "you are a helpful assistant" boilerplate, no lengthy tool descriptions (those go in the tool schemas), no examples (those go in the few-shot section). Every sentence is an actionable instruction.

---

## 3.7 The Full Context Assembly: From Components to API Call

Putting it all together, here is the exact context assembly pipeline for a production agent:

```python
def assemble_context(
    session: AgentSession,
    new_tool_results: list[dict] | None = None
) -> dict:
    """Assemble the full API request payload for one agent turn."""
    
    # 1. System prompt: static + dynamic sections
    system_parts = []
    
    # Static section (cached)
    system_parts.append({
        "type": "text",
        "text": STATIC_SYSTEM_PROMPT,  # ~350 tokens, never changes
        "cache_control": {"type": "ephemeral"}
    })
    
    # Dynamic section (per-session)
    dynamic = build_dynamic_section(session)
    if dynamic:
        system_parts.append({
            "type": "text",
            "text": dynamic  # ~100-4000 tokens, varies per session
        })
    
    # 2. Messages: conversation history
    messages = list(session.messages)  # Copy to avoid mutation
    
    # Append new tool results if any
    if new_tool_results:
        messages.append({"role": "user", "content": new_tool_results})
    
    # 3. Check token budget and compact if needed
    total_tokens = estimate_tokens_for_request(system_parts, TOOLS, messages)
    
    if total_tokens > COMPACT_THRESHOLD:
        messages = compact_messages(
            messages, 
            target_tokens=TARGET_AFTER_COMPACT,
            preserve_first=True,
            preserve_last_n=6
        )
    
    # 4. Assemble the API request
    request = {
        "model": session.model,
        "max_tokens": 16000,
        "system": system_parts,
        "tools": TOOLS,  # Static tool definitions, ~1800 tokens
        "messages": messages,
    }
    
    return request


def build_dynamic_section(session: AgentSession) -> str:
    parts = []
    
    # Environment info
    parts.append(f"Working directory: {session.workspace_path}")
    parts.append(f"OS: {platform.system()} {platform.release()}")
    parts.append(f"Shell: {os.environ.get('SHELL', '/bin/bash')}")
    
    # Container detection
    if is_container():
        parts.append(f"Container: Yes ({detect_container_type()})")
    
    # Project memory (CLAUDE.md / AGENTS.md)
    memory = load_project_memory(session.workspace_path)
    if memory:
        parts.append(f"\n## Project Memory\n{memory}")
    
    return "\n".join(parts)
```

### The Full Token Budget at Assembly Time

For a mid-session turn (turn 25 of a debugging task):

```
Component                              Tokens    Cached?
──────────────────────────────────────────────────────────
Static system prompt                     350     Yes
Tool definitions (19 tools)            1,800     Yes
Dynamic section (env + CLAUDE.md)        500     No
Message 1: user goal                     120     Yes (prefix)
Messages 2-20: prior tool calls       22,000     Yes (prefix)
Messages 21-24: recent tool calls       5,500     Yes (prefix, recent additions)
Message 25: new tool result             1,200     No (new)
──────────────────────────────────────────────────────────
Total input:                          31,470
  Cached:                             29,770     (94.6% cache rate)
  New:                                 1,700
  
Cost for this turn:
  Cached: 29,770 × $0.30/MTok = $0.009
  New:     1,700 × $3.00/MTok = $0.005
  Output:    ~80 × $15.00/MTok = $0.001
  Total:                         $0.015
```

Compare to the same turn without caching: 31,470 × $3.00/MTok = $0.094. Caching provides a 6x cost reduction on this turn. Over a full session, the cumulative savings are even greater because earlier turns have a higher cache rate.

---

## 3.8 Production Failure Modes and Their Fixes

This section catalogs specific failure modes encountered in production agent systems, with their root causes and fixes. Each is drawn from real incidents.

### Failure: Non-Deterministic JSON Serialization Kills Cache

**Symptom:** KV-cache hit rate is 10-15% when it should be 85%+. Agent sessions cost 5-8x expected.

**Root cause:** Tool results are serialized with `json.dumps()` without `sort_keys=True`. Different Python code paths construct the same logical dict with different key insertion orders. The resulting JSON strings differ, breaking the prefix match at the first differing byte.

**Diagnosis:**
```python
# Log adjacent turns' message hashes
for i, msg in enumerate(messages):
    h = hashlib.md5(json.dumps(msg, sort_keys=True).encode()).hexdigest()[:8]
    h_raw = hashlib.md5(json.dumps(msg).encode()).hexdigest()[:8]
    if h != h_raw:
        print(f"Turn {i}: sorted={h} unsorted={h_raw} — KEY ORDERING DIFFERS")
```

**Fix:**
```python
# In all message serialization:
json.dumps(tool_result, sort_keys=True, ensure_ascii=False)
```

### Failure: System Prompt Timestamp Invalidates Entire Cache

**Symptom:** Zero cache reuse. Every turn pays full input cost.

**Root cause:** `f"Current time: {datetime.now()}"` is the first line of the system prompt. It changes every second.

**Fix:** Move dynamic content after the cache boundary. Or remove the timestamp entirely — most agent tasks don't need it.

### Failure: Tool Output Explosion Fills Context Window

**Symptom:** Agent fails after 8-10 turns with context-length error. Expected to run 30+ turns.

**Root cause:** `bash("find / -name '*.py'")` returns 50,000 characters of output, which consumes 12,500 tokens of context. Three such commands exhaust the history budget.

**Fix:** Tool output truncation at the source:

```python
MAX_TOOL_OUTPUT = 30_000  # characters

def truncate_output(output: str) -> str:
    if len(output) <= MAX_TOOL_OUTPUT:
        return output
    half = MAX_TOOL_OUTPUT // 2
    omitted = len(output) - MAX_TOOL_OUTPUT
    return (
        output[:half] + 
        f"\n\n[...{omitted:,} characters omitted...]\n\n" + 
        output[-half:]
    )
```

Additionally, the system prompt should instruct the agent to use targeted commands: `find src/ -name '*.py'` instead of `find / -name '*.py'`.

### Failure: Agent Edits File With Stale Line Numbers

**Symptom:** `edit_file` applies the change to the wrong location, or fails because `old_string` doesn't match.

**Root cause:** The agent read the file 10 turns ago, made an edit 5 turns ago (which shifted line numbers), and is now trying to edit based on the original line numbers.

**Fix:** Add to system prompt:
```
After editing a file, if you need to make another edit to the same file, 
re-read it first. Line numbers change after edits.
```

And implement server-side validation:

```python
def validate_edit(file_path: str, old_string: str) -> tuple[bool, str]:
    content = Path(file_path).read_text()
    count = content.count(old_string)
    if count == 0:
        return False, f"old_string not found in {file_path}. The file may have changed. Re-read it."
    if count > 1:
        return False, f"old_string matches {count} locations. Include more context to disambiguate."
    return True, "OK"
```

### Failure: Compaction Loses Critical Context

**Symptom:** After compaction, the agent "forgets" the original task or key discoveries, and either re-does work or goes off-track.

**Root cause:** Naive compaction (truncate oldest turns) removes the turns where the agent identified the root cause of a bug, so after compaction it re-investigates from scratch.

**Fix:** Importance-weighted compaction that always preserves:
1. The first message (original task)
2. Messages containing TODO list updates (the plan)
3. Messages containing error messages (key discoveries)
4. The last 6-8 messages (recent context)

```python
def should_preserve(msg: dict, index: int, total: int) -> bool:
    if index == 0:
        return True  # First message (original task)
    if index >= total - 8:
        return True  # Recent messages
    
    content = str(msg.get("content", ""))
    if "todo" in content.lower():
        return True  # Plan updates
    if "error" in content.lower() and len(content) < 2000:
        return True  # Error messages (but not huge error dumps)
    
    return False
```

### Failure: Agent Gets Stuck in Edit-Test-Fail Loop

**Symptom:** Agent makes an edit, runs tests, sees failure, makes a slightly different edit, runs tests, sees same failure, makes another slightly different edit... for 30+ turns.

**Root cause:** The model is making surface-level fixes without understanding the root cause. Each edit addresses a symptom, not the underlying problem.

**Fix:** Repetition detection + strategy-shift injection:

```python
consecutive_test_failures = 0

for turn in range(MAX_TURNS):
    # ... execute turn ...
    
    if last_tool_was_test and test_failed:
        consecutive_test_failures += 1
        
        if consecutive_test_failures >= 3:
            messages.append({
                "role": "user",
                "content": (
                    f"Tests have failed {consecutive_test_failures} times in a row. "
                    "Stop making changes. Instead:\n"
                    "1. Re-read the original error message.\n"
                    "2. Add debug logging to identify the exact point of failure.\n"
                    "3. Re-examine your assumptions about what the code does.\n"
                    "Do NOT make another edit until you have new information."
                )
            })
    else:
        consecutive_test_failures = 0
```

---

## 3.9 Cost Engineering: Real Numbers for Real Sessions

### Per-Turn Cost Breakdown

For Claude Sonnet 4 (as of early 2026):

```
Input tokens (uncached):   $3.00 / million
Input tokens (cached):     $0.30 / million
Output tokens:            $15.00 / million

Example: Turn 30 of a debugging session
  Input:  45,000 tokens total
    Cached: 42,000 (93.3%)  → $0.0126
    New:     3,000 (6.7%)   → $0.0090
  Output:    150 tokens      → $0.0023
  
  Turn cost: $0.024
```

### Per-Session Cost Profile

```
Light task (5 turns, bug fix):
  Total input:    25,000 tokens (cumulative)
  Total output:      800 tokens
  Cache rate:     78%
  Total cost:     $0.06 - $0.10

Medium task (20 turns, feature implementation):
  Total input:   450,000 tokens (cumulative)
  Total output:    4,000 tokens
  Cache rate:     88%
  Total cost:     $0.25 - $0.50

Heavy task (50 turns, refactoring with debugging):
  Total input: 2,500,000 tokens (cumulative)
  Total output:   12,000 tokens
  Cache rate:     92%
  Total cost:     $1.00 - $2.50

Pathological (200 turns, stuck in loops):
  Total input: 15,000,000 tokens (cumulative)
  Total output:   50,000 tokens
  Cache rate:     85%
  Total cost:     $6.00 - $15.00
```

### Cost Optimization Checklist

In order of impact:

1. **Fix KV-cache stability** (10x impact on input cost). Verify with `cache_read_input_tokens` in API response.
2. **Truncate tool outputs** (2-5x impact). Cap at 30K characters, truncate from middle.
3. **Compact proactively** (2-3x impact). Don't wait for context-length errors.
4. **Use appropriate models** (2-4x impact). Use fast/cheap models for simple tasks, expensive models for complex ones.
5. **Reduce output verbosity** (1.2-1.5x impact). "Don't explain, just do" in system prompt.

### The Model Selection Decision

For multi-model agent architectures:

```python
def select_model(task_complexity: str, turn_count: int) -> str:
    if task_complexity == "simple" and turn_count < 5:
        return "claude-3-5-haiku-20241022"  # $0.25/$1.25 per MTok
    elif task_complexity == "medium":
        return "claude-sonnet-4-20250514"    # $3.00/$15.00 per MTok
    elif task_complexity == "hard" or turn_count > 30:
        return "claude-sonnet-4-20250514"    # Same, with extended thinking
    else:
        return "claude-sonnet-4-20250514"    # Default
```

OpenAI's equivalent:
- Simple: `gpt-4.1-mini` ($0.40/$1.60 per MTok)
- Medium: `gpt-4.1` ($2.00/$8.00 per MTok)
- Complex: `o3-mini` ($1.10/$4.40 per MTok, includes reasoning tokens)

The cost difference between models is 5-15x. Using the right model for the task is the second-highest-leverage cost optimization after caching.

---

## Summary: The Practitioner's Foundations

Part I establishes the engineering foundations for building production agent systems:

1. **The agent loop is an HTTP POST in a while loop.** Every production agent — Codex, Claude Code, Cursor — is a `while(tool_use)` loop around an API call. The sophistication is in what goes *into* the loop, not the loop itself.

2. **KV-cache optimization is the single highest-leverage technique.** Stable prefixes, append-only context, deterministic serialization, and explicit cache boundaries can reduce costs by 6-10x. Non-deterministic JSON key ordering alone can drop cache hit rates from 95% to 12%.

3. **Token budgeting is memory management.** A 128K context window is a fixed resource. Allocate 3% to system prompt, 2% to tools, 3% to few-shot, 30% to working documents, 30% to history, 32% to output headroom. Rebalance dynamically based on task type.

4. **Context rot is measurable and preventable.** Agent accuracy drops 10-25% as context grows past 50K tokens. Mitigate with proactive compaction, importance-weighted retention, sub-agent isolation, and TODO-list anchoring.

5. **Termination is the hardest problem.** Five signals — model stop, hard limits, token budget, repetition detection, and verification — must work together. Verification before termination (run tests, check lint) improves resolution rates by 10-15 percentage points.

6. **System prompts are programs, not prose.** The Claude Code prompt is 14,902 lines of TypeScript that assembles 40+ sections conditionally. Every sentence should be an actionable instruction, not a description.

7. **Real failures have real fixes.** Stale line numbers, tool output explosions, edit-test-fail loops, compaction amnesia — each has a specific, implementable solution. The difference between a working agent and a broken one is usually 5-10 specific engineering decisions, not a fundamental architecture change.

Part II builds on these foundations with tool design patterns, multi-agent orchestration, and the infrastructure required to run agents at scale.
