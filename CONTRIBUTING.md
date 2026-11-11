# Contributing to @erikenz/pi-model-switch

Thank you for your interest in contributing! This project is an open-source extension for the [Pi coding agent](https://github.com/earendil-works/pi-coding-agent).

## Development Setup

1. **Fork and clone** this repository:

   ```bash
   git clone https://github.com/<your-username>/pi-extensions.git
   cd pi-extensions
   ```

2. **Install dependencies**:

   ```bash
   pnpm install
   ```

3. **Link for local testing in Pi**:
   ```bash
   ln -s "$(pwd)/packages/pi-model-switch/extensions/index.ts" ~/.config/pi/agent/extensions/pi-model-switch.ts
   ```

## Workflow & Code Standards

- **Create a feature branch**:
  ```bash
  git checkout -b feat/your-feature-name
  ```
- **Run tests**:
  ```bash
  pnpm test
  ```
- **Typecheck**:
  ```bash
  pnpm typecheck
  ```
- All tests and type checks must pass before opening a PR.

## Submitting Pull Requests

1. Commit your changes using [Conventional Commits](https://www.conventionalcommits.org/) (e.g. `feat: ...`, `fix: ...`, `docs: ...`, `test: ...`).
2. Push your branch to GitHub and open a pull request against `main`.
3. Fill out the pull request template with a concise summary and evidence (test runs / before-and-after).
4. CI will automatically run tests and typechecks against your PR.
