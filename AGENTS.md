# Repository Guidelines

## Project Structure & Module Organization
The extension source lives under `src/`, split by runtime: `background/` for service worker logic, `content/` for in-page overlays, `popup/` for the browser action UI, and `shared/` for reusable types, messaging helpers, and storage code. Specs, factories, and Vitest setup sit in `src/test/`. Static assets flow from `public/`, while production bundles land in `dist/`. Reference `manifest.config.ts` when adjusting Chrome permissions or entry points. Strategic design notes live in `docs/issues/`, including the persona tuning plan in `docs/issues/弹幕 Persona 优化问题与方案说明.md`.

## Build, Test, and Development Commands
Use `npm run dev` for Vite dev, `npm run build` for production output, and `npm run preview` for the built bundle. Guard types with `npm run typecheck`, check lint/format via `npm run lint` and `npm run format:check`, and only apply `npm run format` when finalizing. Run `npm run replay:cues` to generate offline transcripts from `src/tools/fixtures/` when you need deterministic reviews.

## Coding Style & Naming Conventions
Follow the existing two-space indentation and trailing semicolons in TypeScript. Prefer TypeScript modules and keep shared contracts in `src/shared/`. Name files by role (`*.service.ts`, `*.controller.ts`) and keep React-like components in lowercase `kebab-case` directories with `main.ts`. Use ESLint (configured in `eslint.config.js`) and Prettier to resolve style disagreements before committing. Runtime messages and types should stay camelCase to match current interfaces.

## Testing Guidelines
We rely on Vitest with the jsdom environment. Keep tests beside their subject using the `.test.ts` or `.spec.ts` suffix. Reuse helpers from `src/test/` for DOM setup and fake storage. Run `npm run test` for a one-off suite, `npm run test:watch` while iterating, and add `vitest run --coverage` when validating reporting through the V8 provider. Include edge cases around storage migrations and messaging channels.

## Commit & Pull Request Guidelines
Git history is light, so establish discipline: write imperative subject lines under 72 characters and include a short body when context is not obvious. Reference related issues in the body using `Refs #123`. PRs should describe the user-facing impact, list manual test steps, and attach screenshots or screen recordings for popup or overlay changes. Ask for review from another extension maintainer before merging.

## Extension Configuration Tips
When adding new surfaces, update `manifest.config.ts` alongside any `public/` icons or locale files. Ensure new permissions remain minimal and document them in the PR. Use `npm run build` before publishing to confirm the CRX output stays under Chrome limits.
