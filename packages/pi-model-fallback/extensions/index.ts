import type { Api, Model } from "@earendil-works/pi-ai";
import type {
  AgentBeforeSettleEvent,
  AgentBeforeSettleEventResult,
  ExtensionAPI,
  ExtensionContext,
  ExtensionVirtualModel,
} from "@earendil-works/pi-coding-agent";

import { handleFallbackCommand } from "../src/commands.ts";
import { FALLBACK_PROVIDER, loadConfig, parseModelKey } from "../src/config.ts";
import { isCoolingDown, markCooldown, routerStore } from "../src/cooldown.ts";
import { isQuotaOrRateLimitError } from "../src/errors.ts";
import { capabilitiesFromModel, createRouter } from "../src/router.ts";
import type { FallbackEntry, RouterState } from "../src/types.ts";

const warn = (message: string): void => {
  process.stderr.write(`[pi-model-fallback] ${message}\n`);
};

const buildDefinition = (
  entry: FallbackEntry,
  primary: Model<Api> | undefined
): ExtensionVirtualModel<RouterState> => ({
  ...capabilitiesFromModel(primary),
  id: entry.id,
  name: entry.name,
  provider: FALLBACK_PROVIDER,
  route: createRouter({
    chain: entry.chain,
    chainId: `${FALLBACK_PROVIDER}/${entry.id}`,
    cooldownMs: entry.cooldownMs,
    warn,
  }),
});

/** Find the first model in the chain that the registry knows about. */
const primaryModelFor = (
  entry: FallbackEntry,
  ctx: ExtensionContext
): Model<Api> | undefined => {
  for (const key of entry.chain) {
    const parsed = parseModelKey(key);
    if (parsed === undefined) {
      continue;
    }
    // oxlint-disable-next-line no-array-method-this-argument
    // eslint-disable-next-line no-array-method-this-argument
    const model = ctx.modelRegistry.find(parsed.provider, parsed.id);
    if (model !== undefined) {
      return model;
    }
  }
  return undefined;
};

let registeredIds = new Set<string>();

const syncRegistrations = (
  pi: ExtensionAPI,
  modelFor: (entry: FallbackEntry) => Model<Api> | undefined
): void => {
  const config = loadConfig();
  const configuredIds = new Set(config.fallbacks.map((entry) => entry.id));

  for (const id of registeredIds) {
    if (configuredIds.has(id)) {
      continue;
    }
    try {
      pi.unregisterVirtualModel(FALLBACK_PROVIDER, id);
    } catch {
      // Ignore: the model may already be gone.
    }
  }

  const nextIds = new Set<string>();
  for (const entry of config.fallbacks) {
    try {
      pi.registerVirtualModel(buildDefinition(entry, modelFor(entry)));
      nextIds.add(entry.id);
    } catch (error) {
      warn(
        `Failed to register ${FALLBACK_PROVIDER}/${entry.id}: ${String(error)}`
      );
    }
  }
  registeredIds = nextIds;
};

const registerCommand = (
  pi: ExtensionAPI,
  name: string,
  description: string
): void => {
  try {
    pi.registerCommand(name, {
      description,
      handler: async (args, ctx) => {
        await handleFallbackCommand(args ?? "", ctx);
      },
    });
  } catch {
    // Ignore conflicts with a command another extension already registered.
  }
};

let lastFailedAssistantEntryId: string | undefined;

const noPrimaryModel = (): Model<Api> | undefined => undefined;

interface AntigravityRuntime {
  closeSession: (id: string) => Promise<void>;
}

const isAntigravityRuntime = (value: unknown): value is AntigravityRuntime =>
  value !== null &&
  typeof value === "object" &&
  "closeSession" in value &&
  typeof value.closeSession === "function";

const isAntigravityHolder = (
  value: unknown
): value is { runtime: AntigravityRuntime } =>
  value !== null &&
  typeof value === "object" &&
  "runtime" in value &&
  isAntigravityRuntime(value.runtime);

const cleanupAntigravitySession = async (
  ctx: ExtensionContext
): Promise<void> => {
  try {
    const key = Symbol.for("pi-antigravity-acp:runtime");
    const container: Record<symbol, unknown> = globalThis;
    const holder = container[key];
    if (isAntigravityHolder(holder)) {
      const sessionId = ctx.sessionManager.getSessionId();
      if (sessionId.length > 0) {
        await holder.runtime.closeSession(sessionId);
      }
    }
  } catch {
    // Best-effort cleanup for stateful Antigravity ACP provider sessions.
  }
};

const handleAgentBeforeSettle = async (
  event: AgentBeforeSettleEvent,
  ctx: ExtensionContext
): Promise<AgentBeforeSettleEventResult | undefined> => {
  const { model } = ctx;
  if (model === undefined || model.provider !== FALLBACK_PROVIDER) {
    return undefined;
  }

  if (lastFailedAssistantEntryId === undefined || event.outcome !== "error") {
    lastFailedAssistantEntryId = undefined;
    return undefined;
  }

  const failedId = lastFailedAssistantEntryId;
  lastFailedAssistantEntryId = undefined;

  const config = loadConfig();
  const entry = config.fallbacks.find((item) => item.id === model.id);
  if (entry === undefined) {
    return undefined;
  }

  const chainId = `${FALLBACK_PROVIDER}/${entry.id}`;
  const currentState = routerStore.get(chainId) ?? {
    activeCandidateIndex: 0,
    cooldowns: {},
  };
  const currentKey = entry.chain[currentState.activeCandidateIndex];
  const now = Date.now();

  if (currentKey !== undefined) {
    currentState.cooldowns = markCooldown(
      currentState.cooldowns,
      currentKey,
      now,
      entry.cooldownMs
    );
    routerStore.set(chainId, currentState);
  }

  const hasOtherHealthy = entry.chain.some(
    (key) =>
      key !== currentKey && !isCoolingDown(currentState.cooldowns, key, now)
  );
  if (!hasOtherHealthy) {
    return undefined;
  }

  if (
    currentKey?.startsWith("antigravity-acp/") ||
    entry.chain.some((key) => key.startsWith("antigravity-acp/"))
  ) {
    await cleanupAntigravitySession(ctx);
  }

  ctx.ui?.notify(
    `Quota limit reached on ${currentKey ?? "model"}. Falling back to next model in chain...`,
    "warning"
  );

  return {
    continue: true,
    entries: [
      ...event.entries,
      {
        replacement: null,
        targetId: failedId,
        type: "context_edit",
      },
    ],
  };
};

const fallbackExtension = (pi: ExtensionAPI): void => {
  syncRegistrations(pi, noPrimaryModel);

  pi.on("session_start", (_event, ctx) => {
    lastFailedAssistantEntryId = undefined;
    syncRegistrations(pi, (entry) => primaryModelFor(entry, ctx));
  });

  pi.on("agent_start", () => {
    lastFailedAssistantEntryId = undefined;
  });

  pi.on("turn_end", (event) => {
    if (
      event.outcome === "error" &&
      event.message.role === "assistant" &&
      isQuotaOrRateLimitError(event.message)
    ) {
      lastFailedAssistantEntryId = event.messageEntryId;
    }
  });

  pi.on("agent_before_settle", handleAgentBeforeSettle);

  registerCommand(
    pi,
    "fallback",
    "Show model fallback chains, active models, and cooldown status"
  );
  registerCommand(
    pi,
    "fallbacks",
    "Alias for /fallback: show model fallback chain status"
  );
};

export default fallbackExtension;
