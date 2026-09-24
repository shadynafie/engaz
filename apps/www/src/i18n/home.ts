import { DEMO_ROSTER, type RosterBot } from "../demo";
import type { Locale } from "./locales";

export type HomeCopy = {
  title: string;
  description: string;
  ogImageAlt: string;
  availableLanguage: string;
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
    getStarted: string;
    viewOnGithub: string;
    setupWithAgent: string;
    copiedForAgent: string;
    copyFailed: string;
  };
  team: {
    eyebrow: string;
    heading: string;
    copy: string;
    example: string;
    roles: Array<{ title: string; task: string }>;
  };
  selfHost: {
    eyebrow: string;
    heading: string;
    copy: string;
    screenshotAlt: string;
    screenshotCaption: string;
    features: Array<{ title: string; body: string }>;
  };
  roster: {
    eyebrow: string;
    heading: string;
    copy: string;
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
  footer: {
    navLabel: string;
    languagesLabel: string;
    links: {
      docs: string;
      changelog: string;
      about: string;
      support: string;
      privacy: string;
    };
  };
};

const EN_ROSTER = DEMO_ROSTER;

const DE_ROSTER: RosterBot[] = [
  {
    name: "Sales Outbound",
    color: "#F5A03C",
    slug: "engaz/sales-outbound",
    desc: "Recherchiert nachts Accounts, bewertet Intent, entwirft in deinem Ton und hinterlässt eine Review-Liste.",
  },
  {
    name: "Inbox Manager",
    color: "#6A6BF5",
    slug: "engaz/inbox-manager",
    desc: "Archiviert den Lärm, antwortet auf Routine-Threads und parkt Entwürfe, die du lesen solltest.",
  },
  {
    name: "Talent Scout",
    color: "#3B82F6",
    slug: "engaz/talent-scout",
    desc: "Liest jede Bewerbung, shortlistet nach deiner Latte und schreibt die Intro-Mails.",
  },
  {
    name: "Expense Manager",
    color: "#F2622A",
    slug: "engaz/expense-manager",
    desc: "Ordnet Belege den Buchungen zu, reicht den Report ein und fragt nach, statt zu raten.",
  },
  {
    name: "Bug Triage",
    color: "#D9508A",
    slug: "engaz/bug-triage",
    desc: "Reproduziert Reports in einem echten Browser und hängt die Schritte an das Issue.",
  },
  {
    name: "Account Manager",
    color: "#9B5CF6",
    slug: "engaz/account-manager",
    desc: "Hält Renewal-Kontext, beantwortet bekannte Fragen und eskaliert den Rest.",
  },
  {
    name: "Paid Media",
    color: "#3EC5A8",
    slug: "engaz/paid-media",
    desc: "Überwacht den Spend täglich, pausiert, was nicht konvertiert, und meldet, was sich geändert hat.",
  },
  {
    name: "Chief of Staff",
    color: "#8B93A8",
    slug: "engaz/chief-of-staff",
    desc: "Führt die Woche: Briefings, Buchungen und Übergaben zwischen deinen anderen Bots.",
  },
];

const KO_ROSTER: RosterBot[] = [
  {
    name: "Sales Outbound",
    color: "#F5A03C",
    slug: "engaz/sales-outbound",
    desc: "밤새 계정을 조사하고 의도를 점수한 뒤, 당신 말투로 초안을 써 검토 목록을 남깁니다.",
  },
  {
    name: "Inbox Manager",
    color: "#6A6BF5",
    slug: "engaz/inbox-manager",
    desc: "잡음을 보관처리하고, 루틴 스레드에 답하며, 확인이 필요한 초안은 보류합니다.",
  },
  {
    name: "Talent Scout",
    color: "#3B82F6",
    slug: "engaz/talent-scout",
    desc: "지원서를 모두 읽고 기준에 맞게 숏리스트한 뒤 소개 메일을 작성합니다.",
  },
  {
    name: "Expense Manager",
    color: "#F2622A",
    slug: "engaz/expense-manager",
    desc: "영수증과 결제를 맞추고 리포트를 제출하며, 추측하기 전에 묻습니다.",
  },
  {
    name: "Bug Triage",
    color: "#D9508A",
    slug: "engaz/bug-triage",
    desc: "실제 브라우저에서 리포트를 재현하고 이슈에 재현 절차를 붙입니다.",
  },
  {
    name: "Account Manager",
    color: "#9B5CF6",
    slug: "engaz/account-manager",
    desc: "갱신 맥락을 유지하고 알려진 질문에 답하며, 나머지는 에스컬레이션합니다.",
  },
  {
    name: "Paid Media",
    color: "#3EC5A8",
    slug: "engaz/paid-media",
    desc: "매일 지출을 지켜보고 전환되지 않는 건 일시정지한 뒤, 바뀐 점을 보고합니다.",
  },
  {
    name: "Chief of Staff",
    color: "#8B93A8",
    slug: "engaz/chief-of-staff",
    desc: "한 주를 운영합니다: 브리핑, 예약, 다른 봇 사이의 핸드오프.",
  },
];

const ZH_ROSTER: RosterBot[] = [
  {
    name: "Sales Outbound",
    color: "#F5A03C",
    slug: "engaz/sales-outbound",
    desc: "夜间调研客户、评估意向，用你的语气起草跟进，并留下待审清单。",
  },
  {
    name: "Inbox Manager",
    color: "#6A6BF5",
    slug: "engaz/inbox-manager",
    desc: "归档杂音、回复例行邮件，把需要你过目的草稿先搁置起来。",
  },
  {
    name: "Talent Scout",
    color: "#3B82F6",
    slug: "engaz/talent-scout",
    desc: "通读每份简历，按你的标准筛出候选名单，并写好介绍邮件。",
  },
  {
    name: "Expense Manager",
    color: "#F2622A",
    slug: "engaz/expense-manager",
    desc: "核对票据与账目、提交报销，拿不准时先问而不是猜。",
  },
  {
    name: "Bug Triage",
    color: "#D9508A",
    slug: "engaz/bug-triage",
    desc: "在真实浏览器里复现报告，并把复现步骤附到工单上。",
  },
  {
    name: "Account Manager",
    color: "#9B5CF6",
    slug: "engaz/account-manager",
    desc: "掌握续约背景，回答常见问题，其余的自动升级给你。",
  },
  {
    name: "Paid Media",
    color: "#3EC5A8",
    slug: "engaz/paid-media",
    desc: "每天盯投放，暂停没有转化的广告，并汇报发生了什么变化。",
  },
  {
    name: "Chief of Staff",
    color: "#8B93A8",
    slug: "engaz/chief-of-staff",
    desc: "统筹整周：准备简报、安排日程，并协调其他 Bot 之间的交接。",
  },
];

const HOME_COPY: Record<Locale, HomeCopy> = {
  en: {
    title: "Engaz | Self-hosted AI team workspace",
    description: "Engaz is an open-source, self-hosted workspace for your AI team. Create agents, connect compatible models, and choose which plugins they can access.",
    ogImageAlt: "Engaz. AI teammates. Real progress. Self-hosted on your own installation.",
    availableLanguage: "English",
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
      badge: "Open source",
      pill: "Self-hosted",
      heading: "AI teammates. Real progress.",
      lead: "Run an AI team in a workspace you control. Create agents for different jobs, connect a model, and choose which plugins each agent can use.",
      getStarted: "Set up Engaz",
      viewOnGithub: "View on GitHub",
      setupWithAgent: "Set up with your agent",
      copiedForAgent: "Copied for your agent",
      copyFailed: "Copy failed. Try again.",
    },
    team: {
      eyebrow: "The team",
      heading: "One brief. Many minds.",
      copy: "Give each agent a job and the right tools. Keep their work together in one workspace.",
      example: "Illustrative roles · Build your own team",
      roles: [
        { title: "Chief", task: "Shape the plan" },
        { title: "Designer", task: "Make it feel right" },
        { title: "Engineer", task: "Build the thing" },
        { title: "Accountant", task: "Watch the numbers" },
      ],
    },
    selfHost: {
      eyebrow: "The product",
      heading: "A workspace for your AI team",
      copy: "Give each agent a role, choose a compatible model, and control access to connected tools.",
      screenshotAlt: "Engaz workspace showing a conversation with an AI agent",
      screenshotCaption: "Engaz web workspace · Isolated test example",
      features: [
        {
          title: "Distinct roles",
          body: "Create agents for different jobs and keep their conversations together in one workspace.",
        },
        {
          title: "Compatible models",
          body: "Connect a supported hosted or local model through your own connection settings.",
        },
        {
          title: "Plugin access",
          body: "Connect supported services and choose which agents can use each connection.",
        },
      ],
    },
    roster: {
      eyebrow: "First run",
      heading: "From installation to your first agent",
      copy: "Engaz is in active development. Follow the self-hosting guide, create the owner account, and connect a model before starting a conversation.",
      steps: [
        { title: "Install Engaz", body: "Follow the self-hosting guide for your computer and storage." },
        { title: "Create the owner account", body: "The first registered account owns the installation." },
        { title: "Connect a model", body: "Choose a compatible model and create your first agent." },
      ],
      bots: EN_ROSTER,
    },
    openSource: {
      eyebrow: "Why Engaz",
      heading: "Your installation. Your choices.",
      copy: "Engaz is open source and runs on hardware you control. Models and connected services may receive task content when you choose to use them.",
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
    footer: {
      navLabel: "Footer",
      languagesLabel: "Language",
      links: {
        docs: "Docs",
        changelog: "Changelog",
        about: "About",
        support: "Support",
        privacy: "Privacy",
      },
    },
  },
  de: {
    title: "Engaz | Selbst gehosteter Arbeitsbereich für KI-Teams",
    description: "Engaz ist ein quelloffener, selbst gehosteter Arbeitsbereich für dein KI-Team. Erstelle Agenten, verbinde kompatible Modelle und bestimme ihren Plugin-Zugriff.",
    ogImageAlt: "Engaz. KI-Teamkollegen. Echter Fortschritt. Auf deiner eigenen Installation.",
    availableLanguage: "German",
    skipToContent: "Zum Inhalt springen",
    starFallback: "Star",
    nav: {
      home: "Engaz-Startseite",
      primary: "Hauptnavigation",
      menu: "Menü",
      product: "Produkt",
      bots: "Das Team",
      selfHost: "Self-host",
      openSource: "Warum Engaz",
      docs: "Docs",
      viewOnGithub: "Auf GitHub ansehen",
    },
    hero: {
      badge: "Open Source",
      pill: "Self-hosted",
      heading: "KI-Teamkollegen. Echter Fortschritt.",
      lead: "Betreibe ein KI-Team in einem Arbeitsbereich unter deiner Kontrolle. Erstelle Agenten für verschiedene Aufgaben, verbinde ein Modell und bestimme, welche Plugins jeder Agent nutzen kann.",
      getStarted: "Engaz einrichten",
      viewOnGithub: "Auf GitHub ansehen",
      setupWithAgent: "Mit deinem Agenten einrichten",
      copiedForAgent: "Für deinen Agenten kopiert",
      copyFailed: "Kopieren fehlgeschlagen. Erneut versuchen.",
    },
    team: {
      eyebrow: "Das Team",
      heading: "Ein Auftrag. Viele Köpfe.",
      copy: "Gib jedem Agenten eine Aufgabe und passende Tools. Behalte ihre Arbeit in einem Arbeitsbereich im Blick.",
      example: "Beispielrollen · Stelle dein eigenes Team zusammen",
      roles: [
        { title: "Koordination", task: "Den Plan gestalten" },
        { title: "Design", task: "Das Erlebnis formen" },
        { title: "Entwicklung", task: "Die Lösung bauen" },
        { title: "Finanzen", task: "Die Zahlen prüfen" },
      ],
    },
    selfHost: {
      eyebrow: "Das Produkt",
      heading: "Ein Arbeitsbereich für dein KI-Team",
      copy: "Gib jedem Agenten eine Rolle, wähle ein kompatibles Modell und kontrolliere den Zugriff auf verbundene Tools.",
      screenshotAlt: "Engaz-Arbeitsbereich mit einem Gespräch mit einem KI-Agenten",
      screenshotCaption: "Engaz-Webarbeitsbereich · Isoliertes Testbeispiel",
      features: [
        {
          title: "Klare Rollen",
          body: "Erstelle Agenten für verschiedene Aufgaben und halte ihre Gespräche in einem Arbeitsbereich zusammen.",
        },
        {
          title: "Kompatible Modelle",
          body: "Verbinde ein unterstütztes gehostetes oder lokales Modell über deine eigenen Verbindungseinstellungen.",
        },
        {
          title: "Plugin-Zugriff",
          body: "Verbinde unterstützte Dienste und wähle, welche Agenten jede Verbindung nutzen dürfen.",
        },
      ],
    },
    roster: {
      eyebrow: "Erster Start",
      heading: "Von der Installation zum ersten Agenten",
      copy: "Engaz befindet sich in aktiver Entwicklung. Folge der Self-Hosting-Anleitung, erstelle das Eigentümerkonto und verbinde ein Modell, bevor du ein Gespräch beginnst.",
      steps: [
        { title: "Engaz installieren", body: "Folge der Self-Hosting-Anleitung für deinen Computer und Speicherort." },
        { title: "Eigentümerkonto erstellen", body: "Das zuerst registrierte Konto besitzt die Installation." },
        { title: "Modell verbinden", body: "Wähle ein kompatibles Modell und erstelle deinen ersten Agenten." },
      ],
      bots: DE_ROSTER,
    },
    openSource: {
      eyebrow: "Warum Engaz",
      heading: "Deine Installation. Deine Entscheidungen.",
      copy: "Engaz ist quelloffen und läuft auf Hardware unter deiner Kontrolle. Modelle und verbundene Dienste können Aufgabeninhalte erhalten, wenn du sie nutzt.",
      selfHostTitle: "Self-host",
      selfHostMeta: "In aktiver Entwicklung",
      selfHostItems: [
        "Quellcode unter Apache-2.0-Lizenz",
        "Eine Installation auf deinem Computer oder Server betreiben",
        "Modell und unterstützte Verbindungen wählen",
      ],
      starOnGithub: "Auf GitHub mit Stern markieren",
      readTheDocs: "Docs lesen",
      cloudTitle: "Cloud",
      cloudBadge: "Mögliche Zukunft",
      cloudMeta: "Kein gehosteter Dienst verfügbar",
      cloudItems: [
        "Engaz heute selbst hosten",
      ],
      getStarted: "Engaz einrichten",
    },
    cta: {
      heading: "Erstelle deinen ersten KI-Teamkollegen",
      copy: "Beginne mit einer Installation unter deiner Kontrolle und gestalte einen Agenten für deine Arbeit.",
      getStarted: "Engaz einrichten",
      viewOnGithub: "Auf GitHub ansehen",
      openSourceValue: "Open Source",
      selfHostValue: "Self-host",
      stats: [
        { value: "stars", label: "GitHub Stars" },
        { value: "license", label: "Lizenz" },
        { value: "openSource", label: "Open Source" },
        { value: "selfHost", label: "Deine Maschine" },
      ],
    },
    getStartedDialog: {
      closeLabel: "Loslegen-Dialog schließen",
      eyebrow: "Loslegen",
      title: "Wie willst du starten?",
      copy: "Engaz ist zum Self-Hosting verfügbar. Folge der Anleitung, um zu beginnen.",
      selfHostNow: "Engaz einrichten",
      selfHostHint: "Installationsschritte stehen in den Docs.",
      cloudWaitlist: "Projektupdates",
      cloudHint: "Hinterlasse deine E-Mail für Neuigkeiten zu künftigen Optionen.",
      back: "Zurück",
      successTitle: "Du bist dabei.",
      successCopy: "Du kannst Engaz heute mithilfe der Anleitung selbst hosten.",
      done: "Fertig",
      viewOnGithub: "Auf GitHub ansehen",
    },
    waitlist: {
      emailLabel: "E-Mail-Adresse",
      placeholder: "du@firma.com",
      submit: "Weiter",
      joining: "Wird eingetragen…",
      success: "Du bist dabei.",
      added: "Hinzugefügt",
      error: "Konnte dich nicht eintragen. Bitte erneut versuchen.",
    },
    footer: {
      navLabel: "Fußzeile",
      languagesLabel: "Sprache",
      links: {
        docs: "Dokumentation",
        changelog: "Änderungsprotokoll",
        about: "Über uns",
        support: "Support",
        privacy: "Datenschutz",
      },
    },
  },
  ko: {
    title: "Engaz | 직접 호스팅하는 AI 팀 워크스페이스",
    description: "Engaz는 직접 호스팅하는 오픈소스 AI 팀 워크스페이스입니다. 에이전트를 만들고 호환 모델을 연결하며 각 에이전트의 플러그인 접근을 정하세요.",
    ogImageAlt: "Engaz. AI 팀원. 실제 진전. 직접 운영하는 설치 환경.",
    availableLanguage: "Korean",
    skipToContent: "본문으로 건너뛰기",
    starFallback: "Star",
    nav: {
      home: "Engaz 홈",
      primary: "주 메뉴",
      menu: "메뉴",
      product: "제품",
      bots: "팀",
      selfHost: "셀프 호스트",
      openSource: "Engaz를 선택하는 이유",
      docs: "Docs",
      viewOnGithub: "GitHub에서 보기",
    },
    hero: {
      badge: "오픈소스",
      pill: "셀프 호스트",
      heading: "AI 팀원. 실제 진전.",
      lead: "직접 관리하는 워크스페이스에서 AI 팀을 운영하세요. 업무별 에이전트를 만들고 모델을 연결한 뒤 각 에이전트가 사용할 플러그인을 선택하세요.",
      getStarted: "Engaz 설정하기",
      viewOnGithub: "GitHub에서 보기",
      setupWithAgent: "에이전트로 설정하기",
      copiedForAgent: "에이전트용으로 복사됨",
      copyFailed: "복사 실패. 다시 시도하세요.",
    },
    team: {
      eyebrow: "팀",
      heading: "하나의 목표. 다양한 시선.",
      copy: "각 에이전트에게 역할과 알맞은 도구를 주세요. 하나의 워크스페이스에서 작업을 확인하세요.",
      example: "예시 역할 · 나만의 팀 구성",
      roles: [
        { title: "총괄", task: "계획 세우기" },
        { title: "디자이너", task: "경험 다듬기" },
        { title: "엔지니어", task: "제품 만들기" },
        { title: "회계 담당", task: "숫자 살피기" },
      ],
    },
    selfHost: {
      eyebrow: "제품",
      heading: "AI 팀을 위한 하나의 워크스페이스",
      copy: "에이전트마다 역할을 정하고 호환 모델을 선택하며 연결된 도구에 대한 접근을 관리하세요.",
      screenshotAlt: "AI 에이전트와의 대화가 보이는 Engaz 워크스페이스",
      screenshotCaption: "Engaz 웹 워크스페이스 · 격리된 테스트 예시",
      features: [
        {
          title: "분명한 역할",
          body: "서로 다른 업무를 맡을 에이전트를 만들고 대화를 한 워크스페이스에서 관리하세요.",
        },
        {
          title: "호환 모델",
          body: "직접 설정한 연결을 통해 지원되는 호스팅 또는 로컬 모델을 사용하세요.",
        },
        {
          title: "플러그인 접근",
          body: "지원되는 서비스를 연결하고 어떤 에이전트가 각 연결을 사용할지 선택하세요.",
        },
      ],
    },
    roster: {
      eyebrow: "첫 실행",
      heading: "설치부터 첫 에이전트까지",
      copy: "Engaz는 현재 활발히 개발 중입니다. 셀프 호스팅 안내서를 따라 설치하고 소유자 계정을 만든 뒤 모델을 연결해 대화를 시작하세요.",
      steps: [
        { title: "Engaz 설치", body: "컴퓨터와 데이터 저장 위치에 맞는 셀프 호스팅 안내서를 따르세요." },
        { title: "소유자 계정 만들기", body: "처음 등록한 계정이 설치 환경의 소유자가 됩니다." },
        { title: "모델 연결", body: "호환 모델을 선택하고 첫 에이전트를 만드세요." },
      ],
      bots: KO_ROSTER,
    },
    openSource: {
      eyebrow: "Engaz를 선택하는 이유",
      heading: "직접 운영하고 직접 선택하세요.",
      copy: "Engaz는 오픈소스이며 직접 관리하는 하드웨어에서 실행됩니다. 선택한 모델과 연결 서비스는 작업에 필요한 내용을 받을 수 있습니다.",
      selfHostTitle: "셀프 호스트",
      selfHostMeta: "개발 진행 중",
      selfHostItems: [
        "Apache-2.0 라이선스 오픈소스",
        "내 컴퓨터나 서버에서 하나의 설치 환경 운영",
        "모델과 지원되는 연결 직접 선택",
      ],
      starOnGithub: "GitHub에서 Star",
      readTheDocs: "문서 읽기",
      cloudTitle: "Cloud",
      cloudBadge: "향후 가능성",
      cloudMeta: "현재 호스팅 서비스는 없습니다",
      cloudItems: [
        "지금 Engaz를 직접 호스팅하세요",
      ],
      getStarted: "Engaz 설정하기",
    },
    cta: {
      heading: "첫 AI 팀원을 만들어 보세요",
      copy: "직접 관리하는 설치 환경에서 시작해 원하는 업무에 맞는 에이전트를 만드세요.",
      getStarted: "Engaz 설정하기",
      viewOnGithub: "GitHub에서 보기",
      openSourceValue: "오픈소스",
      selfHostValue: "셀프 호스트",
      stats: [
        { value: "stars", label: "GitHub 스타" },
        { value: "license", label: "라이선스" },
        { value: "openSource", label: "오픈소스" },
        { value: "selfHost", label: "당신 머신" },
      ],
    },
    getStartedDialog: {
      closeLabel: "시작하기 대화상자 닫기",
      eyebrow: "시작하기",
      title: "어떻게 시작할까요?",
      copy: "Engaz를 직접 호스팅할 수 있습니다. 설정 안내서를 따라 시작하세요.",
      selfHostNow: "Engaz 설정하기",
      selfHostHint: "설치 단계는 문서에 있습니다.",
      cloudWaitlist: "프로젝트 소식",
      cloudHint: "향후 옵션에 관한 소식을 받으려면 이메일을 남겨 주세요.",
      back: "뒤로",
      successTitle: "등록되었습니다.",
      successCopy: "안내서를 따라 지금 Engaz를 직접 호스팅할 수 있습니다.",
      done: "완료",
      viewOnGithub: "GitHub에서 보기",
    },
    waitlist: {
      emailLabel: "이메일 주소",
      placeholder: "you@company.com",
      submit: "계속",
      joining: "등록 중…",
      success: "등록되었습니다.",
      added: "추가됨",
      error: "등록하지 못했습니다. 다시 시도하세요.",
    },
    footer: {
      navLabel: "푸터",
      languagesLabel: "언어",
      links: {
        docs: "문서",
        changelog: "변경 내역",
        about: "소개",
        support: "지원",
        privacy: "개인정보 처리방침",
      },
    },
  },
  zh: {
    title: "Engaz | 自托管 AI 团队工作空间",
    description: "Engaz 是开源的自托管 AI 团队工作空间。创建智能体、连接兼容模型，并决定每个智能体可使用哪些插件。",
    ogImageAlt: "Engaz：AI 队友，切实推进工作。运行在你自己的安装环境中。",
    availableLanguage: "Chinese",
    skipToContent: "跳到主要内容",
    starFallback: "加星",
    nav: {
      home: "Engaz 首页",
      primary: "主导航",
      menu: "菜单",
      product: "产品",
      bots: "团队",
      selfHost: "自托管",
      openSource: "为什么选择 Engaz",
      docs: "文档",
      viewOnGithub: "在 GitHub 上查看",
    },
    hero: {
      badge: "开源",
      pill: "自托管",
      heading: "AI 队友。切实推进工作。",
      lead: "在你掌控的工作空间里组建 AI 团队。为不同工作创建智能体，连接模型，并选择每个智能体可使用的插件。",
      getStarted: "设置 Engaz",
      viewOnGithub: "在 GitHub 上查看",
      setupWithAgent: "用你的智能体安装",
      copiedForAgent: "已为你的智能体复制",
      copyFailed: "复制失败。请重试。",
    },
    team: {
      eyebrow: "团队",
      heading: "一个目标，多种专长。",
      copy: "为每个智能体分配工作和合适的工具，在同一个工作空间查看他们的进展。",
      example: "示例角色 · 组建自己的团队",
      roles: [
        { title: "负责人", task: "制定计划" },
        { title: "设计师", task: "打磨体验" },
        { title: "工程师", task: "构建产品" },
        { title: "会计", task: "核对数字" },
      ],
    },
    selfHost: {
      eyebrow: "产品",
      heading: "一个工作空间，管理你的 AI 团队",
      copy: "为每个智能体分配角色，选择兼容模型，并管理它们对已连接工具的访问。",
      screenshotAlt: "Engaz 工作空间，显示与 AI 智能体的对话",
      screenshotCaption: "Engaz 网页工作空间 · 隔离测试示例",
      features: [
        {
          title: "明确分工",
          body: "为不同工作创建智能体，在同一个工作空间管理它们的对话。",
        },
        {
          title: "兼容模型",
          body: "通过你自己的连接设置使用受支持的托管或本地模型。",
        },
        {
          title: "插件访问",
          body: "连接受支持的服务，并选择哪些智能体可以使用每个连接。",
        },
      ],
    },
    roster: {
      eyebrow: "初次使用",
      heading: "从安装到第一个智能体",
      copy: "Engaz 仍在积极开发中。按照自托管指南安装，创建所有者账号，再连接模型并开始对话。",
      steps: [
        { title: "安装 Engaz", body: "按照适用于你的电脑和存储位置的自托管指南操作。" },
        { title: "创建所有者账号", body: "第一个注册的账号将成为该安装环境的所有者。" },
        { title: "连接模型", body: "选择兼容模型，并创建你的第一个智能体。" },
      ],
      bots: ZH_ROSTER,
    },
    openSource: {
      eyebrow: "为什么选择 Engaz",
      heading: "你的安装环境，由你选择。",
      copy: "Engaz 开源，运行在你掌控的硬件上。使用模型或已连接服务时，任务内容可能会发送给相应的提供方。",
      selfHostTitle: "自托管",
      selfHostMeta: "持续开发中",
      selfHostItems: [
        "采用 Apache-2.0 许可证的开源代码",
        "在自己的电脑或服务器上运行单个安装环境",
        "选择模型和受支持的连接",
      ],
      starOnGithub: "在 GitHub 上点星",
      readTheDocs: "阅读文档",
      cloudTitle: "云端",
      cloudBadge: "未来方向",
      cloudMeta: "目前没有托管服务",
      cloudItems: [
        "现在就可以自行托管 Engaz",
      ],
      getStarted: "设置 Engaz",
    },
    cta: {
      heading: "创建你的第一个 AI 队友",
      copy: "先搭建由你掌控的安装环境，再为你的工作创建合适的智能体。",
      getStarted: "设置 Engaz",
      viewOnGithub: "在 GitHub 上查看",
      openSourceValue: "开源",
      selfHostValue: "自托管",
      stats: [
        { value: "stars", label: "GitHub 星标" },
        { value: "license", label: "许可证" },
        { value: "openSource", label: "开源" },
        { value: "selfHost", label: "你的机器" },
      ],
    },
    getStartedDialog: {
      closeLabel: "关闭开始使用对话框",
      eyebrow: "开始使用",
      title: "你想如何开始？",
      copy: "Engaz 可供自行托管。按照设置指南即可开始。",
      selfHostNow: "设置 Engaz",
      selfHostHint: "安装步骤见文档。",
      cloudWaitlist: "项目动态",
      cloudHint: "留下邮箱，了解未来可能提供的选项。",
      back: "返回",
      successTitle: "登记成功。",
      successCopy: "你现在可以按照指南自行托管 Engaz。",
      done: "完成",
      viewOnGithub: "在 GitHub 上查看",
    },
    waitlist: {
      emailLabel: "邮箱地址",
      placeholder: "you@company.com",
      submit: "继续",
      joining: "正在登记…",
      success: "登记成功。",
      added: "已添加",
      error: "未能添加你，请重试。",
    },
    footer: {
      navLabel: "页脚",
      languagesLabel: "语言",
      links: {
        docs: "文档",
        changelog: "更新日志",
        about: "关于",
        support: "支持",
        privacy: "隐私",
      },
    },
  },
};

export function getHomeCopy(locale: Locale): HomeCopy {
  return HOME_COPY[locale];
}
