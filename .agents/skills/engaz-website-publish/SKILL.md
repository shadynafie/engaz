---
name: engaz-website-publish
description: Publish or troubleshoot the Engaz public website in apps/www through Cloudflare Pages. Use for website updates, automatic deployment, preview checks, or engaz.app setup; not for the self-hosted Engaz stack.
---

# Publish the Engaz website

The public Astro site is `apps/www`. The signed-in Engaz installation is a separate self-hosted stack.

## Deployment setup

As verified on 2026-09-24, the Cloudflare Pages project `engaz` is connected to `shadynafie/engaz`. Production tracks `main`, automatic deployments are enabled, and the initial deployment succeeded at `https://engaz.pages.dev/`. The registered `engaz.app` domain was active in Cloudflare but had not been added to the Pages project. Recheck these live states before reporting them as current.

Pages builds from the repository root with `pnpm --filter @engaz/www build` and publishes `apps/www/dist`. Its build variables are `NODE_VERSION=24.21.0` and `PNPM_VERSION=9.15.0`.

## For a website update

1. Read `AGENTS.md`, inspect `git status`, and scope the change to the requested site work. Do not sweep unrelated local edits into a website commit. Check `gh auth status` before pushing; use the `shadynafie` account for this repository.
2. Check the public site URL in `apps/www/astro.config.mjs` and `apps/www/src/site.ts`. Keep the displayed installation command aligned with `docs/self-host.md` and the actual installer. The current `apps/www/api/waitlist.ts` is not served by a static Pages build; if a visible form depends on it, supply a working Pages function or remove the form as the task requires.
3. Run `pnpm --filter @engaz/www check` and `pnpm --filter @engaz/www build`; run the focused web test when a changed interaction needs it. Follow the repository's PR and UI review rules when they apply.
4. Push the reviewed change through the repository's chosen workflow. Only a push to `main` updates the production Pages site; other branches get previews. Verify the Cloudflare deployment succeeded for the exact commit, then open the resulting URL and check the changed page and install command. A successful local build alone is not publication.
5. For the requested initial public-domain launch, add `engaz.app` in the Pages project's **Custom domains** once the intended site is ready; verify HTTPS, the homepage, and the install command there. Do not assume the domain is connected merely because it is registered.
