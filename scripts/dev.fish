#!/usr/bin/env fish
# scripts/dev.fish
#
# Interactive runner to start Pi in isolated mode (-ne) with:
# 1. Monorepo packages (all selected by default)
# 2. Installed Pi extensions (0 or more, unselected by default)
#
# Powered by @clack/prompts for a modern, beautiful CLI experience.
# Any additional arguments passed to this script are forwarded to `pi`.

set -l script_dir (status dirname)
set -l repo_root (path resolve "$script_dir/..")

# Check node availability
if not command -s node >/dev/null
    echo (set_color red)"Error: Node.js is required to run the development launcher."(set_color normal) >&2
    exit 1
end

exec node "$repo_root/scripts/dev.ts" $argv
