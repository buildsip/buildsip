import { spawnSync } from "node:child_process";

const bump = process.argv[2];

if (!["patch", "minor", "major"].includes(bump)) {
  throw new Error('Expected "patch", "minor", or "major".');
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("pnpm", [
  "--filter",
  "./packages/cli",
  "version",
  bump,
  "--message",
  "chore: release buildsip@%s",
]);
run("git", ["push"]);
run("git", ["push", "--follow-tags"]);
