# Release policy

## One public channel

The public commands at `engaz.app/install.sh` and `engaz.app/install.ps1` download the
installer assets of GitHub's latest **published stable release**. `engaz update`
selects that same release. Drafts, prereleases, and unpublished tags never advance
this channel. Resolve the release once per operation; do not mix it with main.

Release installer assets freeze the source commit used for Compose files, the CLI,
and `sha-<full-commit>` application and computer images. Windows reboot/resume and
its WSL handoff use that version's installer assets. Existing installations retain
their original secrets, storage identity, and network settings. Known release
downgrades are refused; rollback uses an earlier backup in a clean installation.

Main and `edge` are development channels. Running the repository's installer
directly is a development path; public instructions use the short stable URLs.
The optional official updater sidecar follows the same release selector; custom
forks retain their explicit source/branch workflow.

## Version numbers

Use `vMAJOR.MINOR.PATCH`, starting from the latest published version:

- **Patch:** compatible bug fixes, installer corrections, and reliability fixes.
  The next release after v0.1.8 for these installer fixes is **v0.1.9**.
- **Minor:** new product capabilities. Before v1.0, breaking changes also increment
  the minor number and require migration/recovery instructions.
- **Major:** breaking changes after v1.0. Release **v1.0.0** only when the v1
  acceptance gates in `roadmap.md` are met.

Reset lower components when increasing a higher one. Documentation-only commits
do not require a product release. The monorepo package versions are not the
installation's release authority; the published GitHub release is.

Never move or reuse a released Git tag, replace published installer assets, or
rebuild a released version. Corrections get a new patch version. Source-addressed
registry tags are not immutable OCI digests; retain verified digests as release
evidence, and the CLI records digest pins during updates and backups.

## Publish in this order

1. Merge the reviewed PR after checks and automated reviews finish.
2. Verify main's app, computer, and updater images for amd64 and arm64, and the
   published-image installation/recovery checks. Record the exact source commit.
3. Push the next version tag at that commit. Verify its stable image publication;
   never claim a source merge means images have published.
4. Generate both public installers from that exact commit:

   ```bash
   python3 infra/compose/release-assets.py vX.Y.Z <full-source-commit> <empty-output-folder>
   ```

5. Create a **draft** GitHub release for the tag. Upload `install-images.sh` and
   `install.ps1`; verify their embedded source commit/version, Windows resume/WSL
   URLs, and fresh image tags. Rehearse installation/update in isolation as relevant.
6. Publish the draft and explicitly mark it latest only after images, assets, and
   checks are ready. Verify both public install URLs, release assets, and the update
   selector agree. Update `roadmap.md` with evidence and remaining real-host gaps.

On the first switch to release assets, publish the release before changing the
website's short redirects. A release that is not ready stays a draft.
