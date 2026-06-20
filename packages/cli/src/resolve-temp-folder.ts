import { access } from "node:fs/promises";
import { join } from "node:path";
import { findBuildSipHomeDir } from "@buildsip/cli-auth";

const TEMP_FOLDER_NAME_PATTERN = /^temp-[a-z0-9]{12}$/;

function assertTempFolderName(temp: string) {
  if (!TEMP_FOLDER_NAME_PATTERN.test(temp)) {
    throw new Error(
      "Invalid --temp value. Pass the temp folder name from prepare.",
    );
  }
}

export async function resolveTempFolder(temp: string) {
  assertTempFolderName(temp);

  const tempDir = join(findBuildSipHomeDir(), temp);

  try {
    await access(tempDir);
  } catch {
    throw new Error(`Temp folder not found: ${temp}`);
  }

  return {
    temp,
    tempDir,
    tempLogsDir: join(tempDir, "logs"),
  };
}
