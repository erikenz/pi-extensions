import type { Api, Model } from "@earendil-works/pi-ai";

export interface ModelSwitchConfig {
  favorites: string[];
  hidden: string[];
  modelThinking?: Record<string, string>;
}

export type Row =
  | { kind: "model"; model: Model<Api> }
  | { kind: "divider" }
  | { kind: "header"; label: string };

export interface WindowSliceResult {
  start: number;
  end: number;
  moreAbove: boolean;
  moreBelow: boolean;
}

export type PickerAction =
  | { type: "move"; delta: number }
  | { type: "jump_first" }
  | { type: "jump_last" }
  | { type: "toggle_fav" }
  | { type: "toggle_default" }
  | { type: "toggle_hide" }
  | { type: "toggle_show_hidden" }
  | { type: "start_filter" }
  | { type: "open_thinking" }
  | { type: "select" }
  | { type: "cancel" }
  | { type: "filter_char"; char: string }
  | { type: "filter_backspace" }
  | { type: "filter_apply" }
  | { type: "filter_cancel" }
  | { type: "ignore" };

export type ThinkingAction =
  | { type: "move"; delta: number }
  | { type: "jump_first" }
  | { type: "jump_last" }
  | { type: "select" }
  | { type: "cancel" }
  | { type: "ignore" };

