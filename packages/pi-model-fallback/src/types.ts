import type { Api, Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import type {
  ModelRoute,
  ModelRouteReason,
  ModelRouteRequest,
} from "@earendil-works/pi-coding-agent";

/** A configured fallback chain: fallback/<id> routes through `chain`. */
export interface FallbackEntry {
  id: string;
  name: string;
  chain: string[];
  cooldownMs: number;
}

export interface FallbackConfig {
  cooldownMs: number;
  fallbacks: FallbackEntry[];
}

/** Router state stored on the session branch by Pi. */
export interface RouterState {
  activeCandidateIndex: number;
  /** Model key (`provider/id`) mapped to the epoch-millisecond time its cooldown ends. */
  cooldowns: Record<string, number>;
}

/** The failure details the router inspects. */
export interface FailureMessage {
  stopReason?: string;
  errorMessage?: string;
}

/**
 * The narrow request shape the router needs. `ModelRouteRequest` satisfies it, while
 * tests can build one without a full conversation transcript.
 */
export interface RouterRequest {
  reason: ModelRouteReason;
  thinkingLevel: ModelThinkingLevel;
  previous?: {
    model: Model<Api>;
    thinkingLevel?: ModelThinkingLevel;
  };
  failed?: {
    model: Model<Api>;
    thinkingLevel?: ModelThinkingLevel;
    message: FailureMessage;
  };
  state?: RouterState;
}

/** The narrow registry surface the router needs. */
export interface RouterContext {
  modelRegistry: {
    find: (provider: string, modelId: string) => Model<Api> | undefined;
  };
}

export type RouterRoute = ModelRoute<RouterState>;

/** Compile-time check that Pi's request shape stays compatible with our narrow one. */
export type _RouterRequestCompatibility =
  ModelRouteRequest<RouterState> extends RouterRequest ? true : never;
