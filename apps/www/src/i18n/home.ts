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
    headingLine1: string;
    headingLine2: string;
    copy: string;
    soloLabel: string;
    groupLabel: string;
    soloCaption: string;
    groupCaption: string;
    example: string;
    roles: Array<{ title: string; focus: string }>;
  };
  selfHost: {
    eyebrow: string;
    heading: string;
    copy: string;
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
      headingLine1: "One teammate.",
      headingLine2: "Or a whole team.",
      copy: "Work with one agent directly. Bring several into a group conversation when the work calls for more.",
      soloLabel: "Solo",
      groupLabel: "Group",
      soloCaption: "One conversation. One agent's own context.",
      groupCaption: "One shared thread. Distinct agents working together.",
      example: "Illustrative scene · Build your own team",
      roles: [
        { title: "Chief", focus: "Turn a brief into a plan." },
        { title: "Designer", focus: "Shape the experience." },
        { title: "Engineer", focus: "Build and test." },
        { title: "Accountant", focus: "Check the numbers." },
      ],
    },
    selfHost: {
      eyebrow: "The product",
      heading: "See the work. Keep control.",
      copy: "Create agents for different jobs. Choose your models and each agent's plugin access. Follow their conversations and handoffs in one workspace.",
      example: "Illustrative agents · Define your own",
    },
    roster: {
      eyebrow: "First run",
      heading: "Your team starts on your machine.",
      installLabel: "Install Engaz",
      installInstruction: "Run this in a terminal on the computer that will host Engaz.",
      installRequirements: "Requires Docker Engine 26+, Compose, curl, and OpenSSL. The installer asks where to keep your data.",
      status: "Active development",
      installGuide: "Installation guide",
      copyCommand: "Copy command",
      copiedCommand: "Copied",
      steps: [
        { title: "Install", body: "Choose where your data lives." },
        { title: "Create the owner", body: "The first account owns this installation." },
        { title: "Meet your first agent", body: "Connect a model, then create an agent." },
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
      headingLine1: "Ein Teammitglied.",
      headingLine2: "Oder ein ganzes Team.",
      copy: "Arbeite direkt mit einem Agenten. Wenn eine Aufgabe mehr braucht, hol weitere in ein Gruppengespräch.",
      soloLabel: "Solo",
      groupLabel: "Gruppe",
      soloCaption: "Ein Gespräch. Der eigene Kontext eines Agenten.",
      groupCaption: "Ein gemeinsamer Chat. Unterschiedliche Agenten arbeiten zusammen.",
      example: "Illustrative Szene · Stelle dein eigenes Team zusammen",
      roles: [
        { title: "Koordination", focus: "Aus einer Aufgabe wird ein Plan." },
        { title: "Design", focus: "Gestaltet das Erlebnis." },
        { title: "Entwicklung", focus: "Setzt um und testet." },
        { title: "Finanzen", focus: "Prüft die Zahlen." },
      ],
    },
    selfHost: {
      eyebrow: "Das Produkt",
      heading: "Sieh die Arbeit. Behalte die Kontrolle.",
      copy: "Erstelle Agenten für verschiedene Aufgaben. Wähle deine Modelle und den Plugin-Zugriff jedes Agenten. Verfolge Gespräche und Übergaben an einem Ort.",
      example: "Beispielagenten · Stelle dein eigenes Team zusammen",
    },
    roster: {
      eyebrow: "Erster Start",
      heading: "Dein Team startet auf deinem Rechner.",
      installLabel: "Engaz installieren",
      installInstruction: "Führe diesen Befehl im Terminal des Computers aus, auf dem Engaz laufen soll.",
      installRequirements: "Benötigt Docker Engine 26+, Compose, curl und OpenSSL. Der Installer fragt, wo deine Daten gespeichert werden sollen.",
      status: "In aktiver Entwicklung",
      installGuide: "Installationsanleitung",
      copyCommand: "Befehl kopieren",
      copiedCommand: "Kopiert",
      steps: [
        { title: "Installieren", body: "Wähle einen Speicherort für deine Daten." },
        { title: "Konto erstellen", body: "Das erste Konto besitzt diese Installation." },
        { title: "Ersten Agenten starten", body: "Verbinde ein Modell und erstelle einen Agenten." },
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
      headingLine1: "팀원 한 명.",
      headingLine2: "또는 팀 전체.",
      copy: "에이전트 한 명과 직접 대화하세요. 더 많은 도움이 필요하면 여러 에이전트를 그룹 대화로 모으세요.",
      soloLabel: "단독",
      groupLabel: "그룹",
      soloCaption: "하나의 대화. 에이전트만의 맥락.",
      groupCaption: "하나의 공유 대화. 서로 다른 에이전트가 함께 일합니다.",
      example: "예시 장면 · 나만의 팀 구성",
      roles: [
        { title: "총괄", focus: "요청을 계획으로 정리합니다." },
        { title: "디자이너", focus: "경험을 설계합니다." },
        { title: "엔지니어", focus: "만들고 검증합니다." },
        { title: "회계 담당", focus: "숫자를 확인합니다." },
      ],
    },
    selfHost: {
      eyebrow: "제품",
      heading: "작업은 한눈에. 제어는 내 손에.",
      copy: "업무에 맞는 에이전트를 만드세요. 모델을 선택하고 각 에이전트의 플러그인 접근을 관리하세요. 대화와 인계는 한 워크스페이스에서 확인할 수 있습니다.",
      example: "예시 에이전트 · 나만의 팀 구성",
    },
    roster: {
      eyebrow: "첫 실행",
      heading: "내 컴퓨터에서 팀을 시작하세요.",
      installLabel: "Engaz 설치",
      installInstruction: "Engaz를 실행할 컴퓨터의 터미널에서 이 명령어를 실행하세요.",
      installRequirements: "Docker Engine 26+, Compose, curl, OpenSSL이 필요합니다. 설치 중 데이터 저장 위치를 선택합니다.",
      status: "개발 진행 중",
      installGuide: "설치 안내서",
      copyCommand: "명령어 복사",
      copiedCommand: "복사됨",
      steps: [
        { title: "설치", body: "데이터 저장 위치를 선택하세요." },
        { title: "소유자 만들기", body: "첫 번째 계정이 이 설치의 소유자가 됩니다." },
        { title: "첫 에이전트 만나기", body: "모델을 연결하고 에이전트를 만드세요." },
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
      headingLine1: "一位队友。",
      headingLine2: "或整个团队。",
      copy: "先与一位智能体直接对话。任务需要更多力量时，就让多位智能体加入群组对话。",
      soloLabel: "单独",
      groupLabel: "群组",
      soloCaption: "一段对话。一位智能体自己的上下文。",
      groupCaption: "一个共享对话。不同智能体协同工作。",
      example: "示意场景 · 组建自己的团队",
      roles: [
        { title: "负责人", focus: "把需求理成计划。" },
        { title: "设计师", focus: "塑造使用体验。" },
        { title: "工程师", focus: "构建并验证。" },
        { title: "会计", focus: "核对数字。" },
      ],
    },
    selfHost: {
      eyebrow: "产品",
      heading: "看清进展，掌握控制权。",
      copy: "为不同工作创建智能体。选择模型并控制每位智能体的插件访问。在同一个工作空间查看对话与交接。",
      example: "示意智能体 · 自由组建你的团队",
    },
    roster: {
      eyebrow: "初次使用",
      heading: "在自己的电脑上组建团队。",
      installLabel: "安装 Engaz",
      installInstruction: "在将要运行 Engaz 的电脑终端中执行此命令。",
      installRequirements: "需要 Docker Engine 26+、Compose、curl 和 OpenSSL。安装程序会询问数据的存储位置。",
      status: "持续开发中",
      installGuide: "安装指南",
      copyCommand: "复制命令",
      copiedCommand: "已复制",
      steps: [
        { title: "安装", body: "选择数据的存储位置。" },
        { title: "创建所有者", body: "第一个账号拥有此安装环境。" },
        { title: "认识首个智能体", body: "连接模型，然后创建智能体。" },
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
