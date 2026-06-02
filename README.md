# Agent Notifier

Sound notifications for AI coding agents in VS Code.

## What it does

Agent Notifier plays a sound when Claude Code or Codex completes a task or needs your attention.

## How to use

1. Install **Agent Notifier** from the VS Code Marketplace.
2. Run **Agent Notifier: Setup Hooks** from the Command Palette.
3. Open the bottom panel with **View > Appearance > Panel**, then select **Agent Notifier**.
4. Click **OFF** once to turn the sound player **ON**.

## How it works

**Setup Hooks** adds notification hooks to Claude Code and Codex. Those hooks write agent events to a shared signal file, and Agent Notifier watches that file to play sounds.
