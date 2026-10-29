import { BotAvatar } from "@engaz/ui-web";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";
import portrait from "../../../../packages/ui-tokens/assets/agent-portraits/team-chief.webp?inline";

const avatars = [
  { name: "Stock", color: "#D9508A", variant: "robot" },
  { name: "Shape", color: "#3B82F6::shape_0", variant: "robot" },
  { name: "Organic", color: "#10B981", variant: "organic" },
  { name: "Uploaded", color: portrait, variant: "robot" },
] as const;

createRoot(document.getElementById("root")!).render(
  <div className="grid min-h-full md:grid-cols-2">
    {(["light", "dark"] as const).map((theme) => (
      <section
        key={theme}
        data-theme={theme}
        className="flex flex-col justify-center gap-12 bg-background p-10 text-foreground"
      >
        <h1 className="text-2xl font-medium">{theme === "light" ? "Light" : "Dark"} appearance</h1>
        <div className="grid grid-cols-2 gap-12">
          {avatars.map((avatar) => (
            <div
              key={avatar.name}
              data-testid={`${theme}-${avatar.name}`}
              className="flex flex-col items-center gap-6"
            >
              <BotAvatar
                color={avatar.color}
                variant={avatar.variant}
                identity={avatar.name}
                size={84}
                status="running"
              />
              <span>{avatar.name}</span>
            </div>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          One comet · avatar colour for stock · theme colour for uploads
        </p>
      </section>
    ))}
  </div>,
);
