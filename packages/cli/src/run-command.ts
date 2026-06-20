import { spawn, type StdioOptions } from "node:child_process";

type RunCommandOptions = {
  cwd?: string;
  verbose?: boolean;
};

export function runCommand(
  command: string,
  args: string[],
  options?: RunCommandOptions,
) {
  return new Promise<string>((resolve, reject) => {
    let output = "";
    const stdio: StdioOptions = options?.verbose
      ? "inherit"
      : ["ignore", "pipe", "pipe"];
    const child = spawn(command, args, {
      cwd: options?.cwd,
      shell: process.platform === "win32",
      stdio,
    });

    if (!options?.verbose) {
      const addOutput = (chunk: Buffer) => {
        output += chunk.toString();
      };

      child.stdout?.on("data", (chunk: Buffer) => {
        addOutput(chunk);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        addOutput(chunk);
      });
    }

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve(output);
        return;
      }

      const message = signal
        ? `${command} was stopped by ${signal}.`
        : `${command} exited with code ${code ?? "unknown"}.`;
      const text = output.trim();

      reject(new Error(text ? `${message}\n\n${text}` : message));
    });
  });
}
