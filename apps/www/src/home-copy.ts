import { DEMO_ROSTER, type RosterBot } from "./demo";

export type HomeCopy = {
  title: string;
  description: string;
  ogImageAlt: string;
  skipToContent: string;
  starFallback: string;
  nav: {
    home: string;
    primary: string;
    menu: string;
    product: string;
    bots: string;
    selfHost: string;
    openSource: string;
    docs: string;
    viewOnGithub: string;
  };
  hero: {
    badge: string;
    pill: string;
    heading: string;
    lead: string;
    viewOnGithub: string;
    setupWithAgent: string;
    copiedForAgent: string;
    copyFailed: string;
  };
  team: {
    headingLine1: string;
    headingLine2: string;
    copy: string;
    soloLabel: string;
    groupLabel: string;
    soloCaption: string;
    groupCaption: string;
    roles: Array<{ title: string; focus: string }>;
  };
  selfHost: {
    heading: string;
    copy: string;
    imageAlt: string;
    example: string;
  };
  roster: {
    eyebrow: string;
    heading: string;
    installLabel: string;
    installInstruction: string;
    installRequirements: string;
    status: string;
    installGuide: string;
    copyCommand: string;
    copiedCommand: string;
    steps: Array<{ title: string; body: string }>;
    bots: RosterBot[];
  };
  openSource: {
    eyebrow: string;
    heading: string;
    copy: string;
    selfHostTitle: string;
    selfHostMeta: string;
    selfHostItems: string[];
    starOnGithub: string;
    readTheDocs: string;
    cloudTitle: string;
    cloudBadge: string;
    cloudMeta: string;
    cloudItems: string[];
    getStarted: string;
  };
  cta: {
    heading: string;
    copy: string;
    getStarted: string;
    viewOnGithub: string;
    openSourceValue: string;
    selfHostValue: string;
    stats: Array<{ value: "stars" | "license" | "openSource" | "selfHost"; label: string }>;
  };
  getStartedDialog: {
    closeLabel: string;
    eyebrow: string;
    title: string;
    copy: string;
    selfHostNow: string;
    selfHostHint: string;
    cloudWaitlist: string;
    cloudHint: string;
    back: string;
    successTitle: string;
    successCopy: string;
    done: string;
    viewOnGithub: string;
  };
  waitlist: {
    emailLabel: string;
    placeholder: string;
    submit: string;
    joining: string;
    success: string;
    added: string;
    error: string;
  };
};

export const HOME_COPY: HomeCopy = {
  title: "Engaz | Self-hosted AI team workspace",
  description: "Free, open-source AI team software for solo founders and small businesses. Self-host Engaz, give agents work, and keep control.",
  ogImageAlt: "Engaz. AI teammates. Real progress. Self-hosted on your own installation.",
  skipToContent: "Skip to content",
  starFallback: "Star",
  nav: {
    home: "Engaz home",
    primary: "Primary",
    menu: "Menu",
    product: "Product",
    bots: "The team",
    selfHost: "Self-host",
    openSource: "Why Engaz",
    docs: "Docs",
    viewOnGithub: "View on GitHub",
  },
  hero: {
    badge: "Free & open source",
    pill: "Self-hosted",
    heading: "AI teammates. Real progress.",
    lead: "For solo founders and small businesses: put AI agents to work on the jobs that keep your business moving. Give them tasks, follow progress, and step in when needed.",
    viewOnGithub: "View on GitHub",
    setupWithAgent: "Set up with your agent",
    copiedForAgent: "Copied for your agent",
    copyFailed: "Copy failed. Try again.",
  },
  team: {
    headingLine1: "One teammate.",
    headingLine2: "Or a whole team.",
    copy: "Work with one agent directly. Bring several into a group conversation when the work calls for more.",
    soloLabel: "Solo",
    groupLabel: "Group",
    soloCaption: "One conversation. One agent's own context.",
    groupCaption: "One shared thread. Distinct agents working together.",
    roles: [
      { title: "Chief", focus: "Turn a brief into a plan." },
      { title: "Designer", focus: "Shape the experience." },
      { title: "Engineer", focus: "Build and test." },
      { title: "Accountant", focus: "Check the numbers." },
    ],
  },
  selfHost: {
    heading: "See the work. Keep control.",
    copy: "Files, conversation, and handoffs stay together. When work needs a sign-in, you take the computer and protected input stays off the thread. Choose each agent's model and plugin access.",
    imageAlt: "Engaz workspace showing Chief attaching a launch plan file, then asking the owner to take over a sign-in.",
    example: "Actual interface · Isolated scripted test run",
  },
  roster: {
    eyebrow: "First run",
    heading: "Your team starts on your machine.",
    installLabel: "Install Engaz",
    installInstruction: "Run one command in a terminal. On Windows, use PowerShell.",
    installRequirements: "It sets up Docker if needed and asks before installing anything.",
    status: "Active development",
    installGuide: "Installation guide",
    copyCommand: "Copy command",
    copiedCommand: "Copied",
    steps: [
      { title: "Install", body: "Choose where your data lives." },
      { title: "Create the owner", body: "The first account owns this installation." },
      { title: "Meet your first agent", body: "Connect a model, then create an agent." },
    ],
    bots: DEMO_ROSTER,
  },
  openSource: {
    eyebrow: "Why Engaz",
    heading: "Your AI team. Free to self-host.",
    copy: "Run Engaz on your own hardware. The software is Apache-2.0 licensed; hosting and model providers may have costs.",
    selfHostTitle: "Self-host",
    selfHostMeta: "In active development",
    selfHostItems: [
      "Apache-2.0 licensed source code",
      "Run one installation on your own computer or server",
      "Choose your model and supported connections",
    ],
    starOnGithub: "Star on GitHub",
    readTheDocs: "Read the docs",
    cloudTitle: "Cloud",
    cloudBadge: "Future possibility",
    cloudMeta: "No hosted service is available",
    cloudItems: [
      "Self-host Engaz today",
    ],
    getStarted: "Set up Engaz",
  },
  cta: {
    heading: "Build your first AI teammate",
    copy: "Start with an installation you control, then shape an agent around the work you want to do.",
    getStarted: "Set up Engaz",
    viewOnGithub: "View on GitHub",
    openSourceValue: "Open source",
    selfHostValue: "Self-host",
    stats: [
      { value: "stars", label: "GitHub stars" },
      { value: "license", label: "License" },
      { value: "openSource", label: "Open source" },
      { value: "selfHost", label: "Your machine" },
    ],
  },
  getStartedDialog: {
    closeLabel: "Close get started dialog",
    eyebrow: "Get started",
    title: "How do you want to start?",
    copy: "Engaz is available to self-host. Follow the setup guide to begin.",
    selfHostNow: "Set up Engaz",
    selfHostHint: "Install steps are in the docs.",
    cloudWaitlist: "Project updates",
    cloudHint: "Leave your email to hear about future options.",
    back: "Back",
    successTitle: "You're in.",
    successCopy: "You can set up a self-hosted installation today using the guide.",
    done: "Done",
    viewOnGithub: "View on GitHub",
  },
  waitlist: {
    emailLabel: "Email address",
    placeholder: "you@company.com",
    submit: "Continue",
    joining: "Joining…",
    success: "You’re in.",
    added: "Added",
    error: "Couldn’t add you. Try again.",
  },
};
