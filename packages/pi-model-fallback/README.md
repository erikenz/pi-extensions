# @erikenz/pi-model-fallback

Automatic, transparent model failover chains for the [Pi coding agent](https://github.com/earendil-works/pi-coding-agent).

Start a turn on a free or cheap model. If it hits a rate limit, quota depletion, or provider overload, Pi quietly fails over to the next model in the chain — no crashed turn, no manual `/model` switch.

```text
fallback/deepseek-flash
  ├─ opencode/deepseek-v4.1-flash        (free tier)
  ├─ opencode-go/deepseek-v4.1-flash     (subscription)
  └─ opencode-go/claude-haiku-5-5        (backup)
```

---

## Features

- 🔗 **Virtual fallback models**: every configured chain registers as `fallback/<id>` and appears in `/model`, `--model`, and model settings like any other model.
- 🚦 **Automatic failover on retry**: a 429, quota error, exhausted credits, insufficient balance, payment requirement, or overload indicator puts the failed model into cooldown and routes the retry to the next candidate.
- ⏱️ **Cooldowns**: cooled-down models are skipped on new turns until their window expires. Default is 30 minutes; override globally or per chain.
- 📌 **Sticky continuations**: tool results and multi-step turns stay on the model that answered the turn, preserving prompt caches and thinking signatures.
- 🧠 **Capability mirroring**: the virtual model inherits `contextWindow`, `maxTokens`, `input`, and supported thinking levels from the chain's primary physical model, so token budgets and compaction work correctly.
- 💾 **Session-aware state**: cooldowns and the active candidate are stored as Pi router state, following session branches, forks, and compaction.
- 🩺 **Status command**: `/fallback` (or `/fallbacks`) shows every chain, its active candidate, and remaining cooldowns. `/fallback reset` clears them.

---

## Installation

### Via Pi packages

```bash
pi install @erikenz/pi-model-fallback
```

Or add it to `~/.config/pi/agent/settings.json`:

```json
{
  "packages": ["npm:@erikenz/pi-model-fallback"]
}
```

### Local development

```bash
ln -s "$(pwd)/packages/pi-model-fallback/extensions/index.ts" \
  ~/.config/pi/agent/extensions/pi-model-fallback.ts
```

---

## Configuration

Create `~/.config/pi/agent/model-fallback.json`:

```json
{
  "$schema": "./schema.json",
  "cooldownMs": 1800000,
  "fallbacks": {
    "deepseek-flash": {
      "name": "DeepSeek Flash (Auto Fallback)",
      "chain": [
        "opencode/deepseek-v4.1-flash",
        "opencode-go/deepseek-v4.1-flash"
      ],
      "cooldownMs": 1800000
    },
    "claude-workhorse": {
      "name": "Claude Smart Fallback",
      "chain": ["opencode-go/claude-sonnet-5-5", "opencode-go/claude-haiku-5-5"]
    }
  }
}
```

| Field | Meaning |
| --- | --- |
| `cooldownMs` | Default cooldown in milliseconds. Defaults to `1800000` (30 minutes). |
| `fallbacks` | Map of chain id to chain configuration. Each id registers `fallback/<id>`. |
| `fallbacks.<id>.name` | Display name. Defaults to `<id> (Auto Fallback)`. |
| `fallbacks.<id>.chain` | Ordered model keys, `provider/model`. The first entry is the preferred model. |
| `fallbacks.<id>.cooldownMs` | Per-chain cooldown override. |

The file is optional. A missing, empty, or invalid file simply means no fallback models are registered. Invalid chain entries are skipped at load time; models that do not exist in the catalog are skipped at route time with a warning.

Then select the virtual model:

```bash
pi --model fallback/deepseek-flash
```

---

## Routing rules

`fallback/<id>` registers a Pi virtual model. Pi calls its router before every request with a `reason`:

| `reason` | Behavior |
| --- | --- |
| `user` | Pick the highest-priority chain model that is not cooling down. If every model is cooling down, pick the one whose cooldown ends soonest. |
| `continuation` | Stay on `request.previous.model` and its thinking level, even if it is cooling down. This keeps tool-call follow-ups on the same model and preserves the prompt cache. |
| `retry` | If `request.failed` reports a quota/rate-limit/overload error, cool the failed model down and route to the next healthy candidate after it. Otherwise retry the failed model. |
| `direct` | Same selection as `user`. Used for compaction summaries and extension-initiated calls. |

The returned state is `{ activeCandidateIndex, cooldowns }`:

```json
{
  "activeCandidateIndex": 1,
  "cooldowns": {
    "opencode/deepseek-v4.1-flash": 1767225600000
  }
}
```

Pi stores it on the session branch, restores it across forks and compaction, and passes it back as `request.state`. The extension also keeps a process-wide copy so `direct` requests and status reporting see current cooldowns.

### Recognized failure indicators

The error matcher checks `request.failed.message.errorMessage` and `stopReason` for:

- HTTP `429`, `402`, `529`, `rate limit`, `too many requests`
- `quota`, `insufficient_quota`, `resource_exhausted`
- `credits exhausted`, `out of credits`, `insufficient balance`, `credit balance is too low`
- `usage limit`, `weekly limit`, `monthly limit`, `daily limit`, `hourly limit`
- `overloaded`, `server at capacity`
- `billing`, `payment required`

Non-quota failures (invalid API key, context overflow, tool errors) do not trigger failover.

---

## Commands

### `/fallback` or `/fallbacks`

Print the status of every configured chain:

```text
Model fallback chains (2):
• deepseek-flash — DeepSeek Flash (Auto Fallback) [fallback/deepseek-flash]
  *1. opencode/deepseek-v4.1-flash — cooling down (29m 12s left)
   2. opencode-go/deepseek-v4.1-flash — ready
• claude-workhorse — Claude Smart Fallback [fallback/claude-workhorse]
   1. opencode-go/claude-sonnet-5-5 — ready
   2. opencode-go/claude-haiku-5-5 — ready
```

`*` marks the active candidate.

### `/fallback reset [chain-id]`

Clear cooldowns for one chain (`deepseek-flash` or `fallback/deepseek-flash`) or for every chain when no id is given.

---

## How it works

```text
Pi turn
  → virtual model fallback/deepseek-flash
  → route(request)
      reason=user         → first healthy candidate
      reason=continuation → request.previous.model
      reason=retry        → quota? cool down + next candidate
  → physical model (streamed by its provider)
```

The package is intentionally small:

| File | Responsibility |
| --- | --- |
| `extensions/index.ts` | Registers virtual models and slash commands; re-mirrors capabilities on `session_start`. |
| `src/config.ts` | Loads and validates `model-fallback.json`. |
| `src/errors.ts` | Classifies quota, rate-limit, and overload errors. |
| `src/cooldown.ts` | Cooldown windows, expiry pruning, and the in-memory router store. |
| `src/router.ts` | The `route(request, ctx)` implementation and capability mirroring. |
| `src/commands.ts` | `/fallback` status and reset command. |

---

## Development

```bash
pnpm install
pnpm -r test       # Node's native test runner
pnpm typecheck     # tsc --noEmit
pnpm check         # ultracite check
```

## License

MIT
