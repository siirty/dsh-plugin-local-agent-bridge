# About this fork

`siirty/dsh-plugin-local-agent-bridge` is a fork of
[Leshm0321/dsh-plugin-local-agent-bridge](https://github.com/Leshm0321/dsh-plugin-local-agent-bridge)
(MIT), adapted for one use: a Linux VM reached over an SSH tunnel or Tailscale,
running Claude Code and Codex on subscription logins for a single operator.

Forked from upstream commit `d0bbfc6`. Upstream's README and docs still describe
the base behaviour; this file lists only what differs.

## Changes

### Codex 0.167.x

- App Server schemas regenerated from Codex `0.167.1` into `generated/codex/0.167.1/`;
  the `0.163.0` artifacts were removed.
- Supported range narrowed to `>=0.167.0 <0.168.0`. Upstream's wider range rested on
  schema comparisons against `0.163.0` artifacts; these artifacts were not compared
  against older releases, and a newer minor has not been compared at all, so both
  sides fail closed. A Codex upgrade means regenerating (`pnpm run generate:codex`
  after updating the version in `package.json`) and moving the range.
- Comparison of `0.163.0` → `0.167.1` over the shapes this bridge reads and sends:
  additive except `ThreadItem` `imageGeneration` no longer carrying `result` (which
  the old pinned schema required) and audio input fields this bridge never sends.

### Hardening

| Change | Why |
| --- | --- |
| `allowBypassMode` (default `false`) | `bypass` skips every approval. Off: not offered, refused on create / mode change, and a stored session still set to it runs as `manual`. |
| `codexSandbox` (default `workspace-write`) | Upstream sets Codex's approval policy but never its sandbox, so the reach of a turn depended on whatever the Host's `config.toml` held. Sent on every `thread/start` and `thread/resume`; `inherit` restores upstream behaviour. |
| `allowHostBrowsing` default `true` → `false` | The panel's widest read; this fork's Host is reached across a network. |
| Redaction patterns | Adds GitHub tokens, JWTs (Supabase keys), AWS key ids, Slack tokens, Stripe keys and PEM private-key blocks. Still best effort: transcripts on disk are not a secret store. |
| Password checks serialised | Concurrent guesses all passed the lockout read before the first failure was recorded; now the sixth wrong guess is refused however they were sent. |

Example Profile override with every key: [`examples/profile/workstation.patch.yml`](examples/profile/workstation.patch.yml).

## Unchanged, and still the operator's job

- **DSH itself has no authentication.** The panel password gates this plugin only.
  Keep the Harness bound to `127.0.0.1` and reach it through an SSH tunnel or an
  authenticated tailnet-only proxy. Never Tailscale Funnel or a public port.
- **Every DSH plugin is fully trusted**: one browser origin (the unlock token is in
  `localStorage`) and full Host privileges. Install no plugin you have not read.
- **One Host account holds every credential the agents can reach.** Confine each
  product's own sandbox (Claude Code `sandbox` and `permissions.deny`, Codex
  `sandbox_mode`) and keep production secrets off the Host.
- Linux has still had no real-product smoke run; see [validation](docs/en/validation.md).

## Syncing upstream

```sh
git fetch upstream
git log --oneline HEAD..upstream/main   # read before merging
git merge upstream/main
pnpm install --frozen-lockfile && pnpm run check
```
