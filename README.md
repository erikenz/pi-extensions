# @erikenz/pi-model-switch

Fast model picker and favorite model cycling shortcuts for the [Pi coding agent](https://github.com/earendil-works/pi-coding-agent).

Inspired by `@aiwayds/pi-model-favorites`, rewritten with dedicated global shortcuts, direct hotkey cycling, and full vim navigation.

---

## Features

- ⭐ **Dual-Pane Model Picker**: Your favorite models are pinned at the top separated by a divider, with all other available models cleanly listed below.
- ⚡ **Global Shortcut (`Alt+M`)**: Open the model picker modal from anywhere without typing a slash command.
- 🔁 **Instant Cycling Shortcuts**:
  - `Ctrl+Alt+P`: Cycle forward through your favorite models with an instant toast notification.
  - `Ctrl+Alt+Shift+P`: Cycle backward through your favorite models.
- ⌨️ **Vim-Friendly Navigation**:
  - `j` / `↓`: Move down.
  - `k` / `↑`: Move up.
  - `g` / `Home`: Jump to first model.
  - `G` / `End`: Jump to last model.
  - `q` / `Esc`: Close picker.
  - `Enter`: Select active model.
- 🧠 **Thinking / Effort Selection (`t` / `e`)**:
  - For models that support reasoning, select your desired thinking/effort level (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`) directly with vim navigation.
  - Displays token budgets / descriptions for each level.
  - Automatically saves your preferred thinking effort per model in `model-switch.json` and reapplies it when switching or cycling favorites.
- 🎯 **In-Picker Management**:
  - `t` or `e`: Open thinking / reasoning effort selector for the focused model.
  - `d`: Set focused model as Pi's global default model (persists to `settings.json`).
  - `f`: Toggle favorite on the focused model.
  - `h`: Toggle hide on the focused model.
  - `v`: Expand/collapse hidden models list.
  - `/`: Live fuzzy filter (type to search; `Enter` to apply, `Esc` to clear).
- 💾 **Clean, Self-Contained Storage**:
  - Saves favorite, hidden, and per-model thinking preferences directly to `~/.config/pi/agent/model-switch.json`.

---

## Installation

### Via Pi Packages

Add to your `~/.config/pi/agent/settings.json`:

```json
{
  "packages": [
    "npm:@erikenz/pi-model-switch"
  ]
}
```

Or install via Pi:

```bash
pi install @erikenz/pi-model-switch
```

### Local / Development

Clone this repository into your extensions directory or symlink it:

```bash
git clone https://github.com/erikenz/pi-model-switch.git ~/Projects/pi-model-switch
ln -s ~/Projects/pi-model-switch/extensions/index.ts ~/.config/pi/agent/extensions/pi-model-switch.ts
```

---

## Keybindings & Shortcuts

| Shortcut / Key | Context | Action |
| --- | --- | --- |
| `Alt+M` | Global | Open the favorite model picker modal |
| `Alt+T` | Global | Cycle thinking / effort level forward for current model |
| `Alt+Shift+T` | Global | Cycle thinking / effort level backward for current model |
| `Ctrl+Alt+P` | Global | Cycle forward to the next favorite model (applies saved thinking level) |
| `Ctrl+Alt+Shift+P` | Global | Cycle backward to the previous favorite model |
| `/m` or `/model-switch` | Slash command | Open picker modal (`cycle [next\|prev]`, `thinking [next\|prev]` also available) |
| `j` / `↓` | Inside Picker | Move cursor down |
| `k` / `↑` | Inside Picker | Move cursor up |
| `g` / `Home` | Inside Picker | Jump to top |
| `G` / `End` | Inside Picker | Jump to bottom |
| `Enter` | Inside Picker | Select focused model |
| `t` or `e` | Inside Picker | Open thinking / effort selector for reasoning-capable models |
| `d` | Inside Picker | Set focused model as Pi's default startup model |
| `f` | Inside Picker | Toggle favorite status |
| `h` | Inside Picker | Toggle hidden status |
| `v` | Inside Picker | Toggle show/hide hidden models |
| `/` | Inside Picker | Start filter / search |
| `q` / `Esc` | Inside Picker | Cancel and close |

---

## Customizing Keybindings & Shortcuts

All global shortcuts and in-modal keys are fully configurable in `~/.config/pi/agent/model-switch.json`. 

You can remap any shortcut, bind multiple keys to the same action, or set a shortcut to `null` to disable it completely.

```json
{
  "shortcuts": {
    "open": "alt+m",
    "cycleNext": "ctrl+alt+p",
    "cyclePrev": "ctrl+alt+shift+p",
    "thinkingNext": "alt+t",
    "thinkingPrev": "alt+shift+t"
  },
  "modalKeys": {
    "up": ["k", "up"],
    "down": ["j", "down"],
    "first": ["g", "home"],
    "last": ["G", "end"],
    "select": ["enter"],
    "cancel": ["q", "escape"],
    "thinking": ["t", "e"],
    "favorite": ["f"],
    "default": ["d"],
    "hide": ["h"],
    "toggleHidden": ["v"],
    "filter": ["/"]
  }
}
```

### Configuration Examples

#### Replace Pi's Default Model Picker (`Ctrl+L`):
```json
{
  "shortcuts": {
    "open": "ctrl+l"
  }
}
```

#### Disable Direct Cycling Shortcuts:
```json
{
  "shortcuts": {
    "cycleNext": null,
    "cyclePrev": null
  }
}
```

#### Colemak Navigation Inside Modal:
```json
{
  "modalKeys": {
    "up": ["u", "up"],
    "down": ["e", "down"]
  }
}
```

## Development & Testing

```bash
# Run unit tests
pnpm test

# Type check
pnpm typecheck
```

---

## License

MIT © [erikenz](https://github.com/erikenz)
