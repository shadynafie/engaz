export const SITE_NAME = "Engaz";
export const SITE_URL = "https://engaz.app";
export const SITE_DESCRIPTION =
  "Engaz is an open-source, self-hosted workspace for your AI team. Create agents, connect a model, and control their plugin access.";

export const GITHUB_URL = "https://github.com/shadynafie/engaz";
export const DOCS_URL = "https://github.com/shadynafie/engaz/blob/main/docs/self-host.md";
export const SETUP_PROMPT_URL = "https://github.com/shadynafie/engaz/blob/main/SETUP_PROMPT.md";
export const CHANGELOG_URL = "https://github.com/shadynafie/engaz/releases";
// public/_redirects points these short addresses at the installers in the repository.
export const INSTALL_COMMANDS = {
  unix: "curl -fsSL https://engaz.app/install.sh | bash",
  windows: "irm https://engaz.app/install.ps1 | iex",
} as const;
export type InstallSystem = keyof typeof INSTALL_COMMANDS;
