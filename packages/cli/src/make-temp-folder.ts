import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { findBuildSipHomeDir } from "@buildsip/cli-auth";

const TEMP_FOLDER_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const TEMP_FOLDER_ID_LENGTH = 12;

function makeTempFolderId() {
  const bytes = randomBytes(TEMP_FOLDER_ID_LENGTH);
  let id = "";

  for (let index = 0; index < TEMP_FOLDER_ID_LENGTH; index++) {
    id +=
      TEMP_FOLDER_ID_ALPHABET[bytes[index]! % TEMP_FOLDER_ID_ALPHABET.length];
  }

  return id;
}

export async function makeTempFolder() {
  const temp = `temp-${makeTempFolderId()}`;
  const tempDir = join(findBuildSipHomeDir(), temp);
  const tempLogsDir = join(tempDir, "logs");

  await mkdir(tempLogsDir, { recursive: true });

  return {
    temp,
    tempDir,
    tempLogsDir,
  };
}
