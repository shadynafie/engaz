// Fails when source messages are missing from the catalogs. A production build
// shows a missing message as its generated id, so every message must be extracted.
import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

const read = () =>
  readdirSync("src/locales")
    .map((locale) => readFileSync(`src/locales/${locale}/messages.po`, "utf8"))
    .join("\n");

const before = read();
execSync("pnpm exec lingui extract --clean", { stdio: "ignore" });
if (read() !== before) {
  console.error("Message catalogs were out of date and have been updated. Commit src/locales.");
  process.exit(1);
}
