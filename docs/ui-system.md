# Shared UI and chat checks

Engaz uses the same web UI in browsers and Electron. Expo keeps native navigation,
menus, permissions, and touch interactions, while sharing appearance and behavior.

- Semantic colors live in `packages/ui-tokens`; regenerate CSS with
  `pnpm --filter @engaz/ui-tokens generate` after changing the palette.
- Chat body size, bubble padding, corner radius, and speaker spacing use
  `CHAT_BUBBLE`. Web and native bubble components live in `packages/chat-ui`.
- Avatar comets share `WORKING_RING` and `workingRingLayout`. Stock avatars use
  their identity color; uploaded images use the theme foreground. Preserve reduced motion.
- Chat timers, execution state, error recovery, and refresh coalescing have shared
  helpers. Keep platform renderers and native interaction hosts small.

Run `pnpm gallery` to inspect the real transcript and composer with synthetic data.
It needs no API, database, model account, or sign-in. The scenario, appearance, and
phone-width controls are developer tools; the fixture is excluded from production
builds. Gallery answers and sends only change local sample state.

Before shipping a visual change, check conversation, working, question, approval,
secret, delegation, card, and long-message scenarios in both appearances and widths.
The gallery browser test captures these states and checks for page errors, overflow,
and unexpected API requests. The main browser suite checks actual sends, cancellation,
error recovery, and byte-preserving spreadsheet uploads against an isolated installation.
A phone-width web screenshot does not verify the native app: native runtime checks and
App Store/Google Play releases remain separate work.
