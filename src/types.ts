import type { Api, Model } from "@earendil-works/pi-ai";

export type KeyBindingSetting = string | string[] | null | false;

export interface ShortcutConfig {
  open?: KeyBindingSetting;
  cycleNext?: KeyBindingSetting;
  cyclePrev?: KeyBindingSetting;
  thinkingNext?: KeyBindingSetting;
  thinkingPrev?: KeyBindingSetting;
}

export interface ModalKeyConfig {
  up?: KeyBindingSetting;
  down?: KeyBindingSetting;
  first?: KeyBindingSetting;
  last?: KeyBindingSetting;
  select?: KeyBindingSetting;
  cancel?: KeyBindingSetting;
  thinking?: KeyBindingSetting;
  favorite?: KeyBindingSetting;
  default?: KeyBindingSetting;
  hide?: KeyBindingSetting;
  toggleHidden?: KeyBindingSetting;
  filter?: KeyBindingSetting;
  block?: KeyBindingSetting;
}

export interface ResolvedShortcuts {
  open: string[];
  cycleNext: string[];
  cyclePrev: string[];
  thinkingNext: string[];
  thinkingPrev: string[];
}

export interface ResolvedModalKeys {
  up: string[];
  down: string[];
  first: string[];
  last: string[];
  select: string[];
  cancel: string[];
  thinking: string[];
  favorite: string[];
  default: string[];
  hide: string[];
  toggleHidden: string[];
  filter: string[];
  block: string[];
}

export interface ModelSwitchConfig {
  favorites: string[];
  hidden: string[];
  blocked: string[];
  modelThinking?: Record<string, string>;
  shortcuts?: ShortcutConfig;
  modalKeys?: ModalKeyConfig;
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
  | { type: "toggle_block" }
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

