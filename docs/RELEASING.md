# Cutting a release

1. Bump `version` in the root `package.json` (and `app/package.json` if you want them to match).
2. Commit, then tag and push:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
3. Pushing a `v*.*.*` tag triggers `.github/workflows/release.yml`, which builds the Windows and macOS installers on GitHub-hosted runners and creates a **draft** GitHub Release with both attached.
4. Go to the repo's [Releases](https://github.com/ka-codes/job-digest-plugin/releases) page, review the draft, add release notes if you want more than the auto-generated ones, and publish it.

Builds are unsigned (no Windows/macOS code-signing certificate) — this is expected and documented in the README's install steps.
