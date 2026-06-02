# Publishing Agent Notifier

This repository is already structured as a VS Code extension. The remaining publishing work is mostly identity, packaging, and release hygiene.

Official references:

- VS Code publishing guide: https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- Extension manifest reference: https://code.visualstudio.com/api/references/extension-manifest

## Before the first release

1. Confirm the Visual Studio Marketplace publisher is `prinwinter`.
2. Confirm `"publisher": "prinwinter"` in `package.json`.
3. Add public project links when they exist:
   - `repository.url`
   - `bugs.url`
   - `homepage`
4. Keep `README.md`, `CHANGELOG.md`, and `LICENSE` in the repository root. These are used by the Marketplace page.
5. Keep `assets/icon.png` at 128x128 or larger. The current icon is 256x256.

## Package a VSIX

```bash
npm install
npm run package
```

This produces `agent-notifier-<version>.vsix`.

Smoke test the package locally:

```bash
code --install-extension agent-notifier-0.1.1.vsix
```

Then open a project in VS Code, run **Agent Notifier: Setup Hooks**, open the **Agent Notifier** panel, and turn the sound player on.

## Publish to the Marketplace

Log in once with the Marketplace publisher id:

```bash
npx @vscode/vsce login prinwinter
```

Publish the current version:

```bash
npm run publish
```

You can also upload the packaged `.vsix` manually from the Visual Studio Marketplace publisher management page.

## Release checklist

- Bump `version` in `package.json`.
- Update `CHANGELOG.md`.
- Run `npm run package`.
- Install the generated `.vsix` locally.
- Test both Claude Code and Codex hook setup if those tools are available.
- Verify the packaged contents do not include source-only files:

```bash
unzip -l agent-notifier-<version>.vsix
```
