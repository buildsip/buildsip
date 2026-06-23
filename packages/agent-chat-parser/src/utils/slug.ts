import * as fs from "fs";

const IS_WINDOWS = process.platform === "win32";

/**
 * Derive cwd from a slug directory name using recursive backtracking.
 * Slugs replace `/` and `.` with `-` in the directory name, e.g.:
 *   "Users-evolution-Sites-localhost-dzcm-test" → "/Users/evolution/Sites/localhost/dzcm.test"
 *
 * At each dash, tries: path separator `/`, dot `.`, or literal `-`.
 * Validates candidates with fs.existsSync(). Falls back to naive slash replacement.
 */
export function cwdFromSlug(slug: string): string {
  const parts = slug.split("-");
  let best: string | null = null;
  const firstPart = parts[0] ?? "";
  const isDriveSlug = /^[A-Za-z]$/.test(firstPart);

  function candidatePaths(segments: string[]): string[] {
    const unixPath = "/" + segments.join("/");
    const firstSegment = segments[0];
    if (firstSegment && /^[A-Za-z]$/.test(firstSegment)) {
      const drive = firstSegment.toUpperCase();
      const rest = segments.slice(1).join("/");
      const winPath = rest ? `${drive}:/${rest}` : `${drive}:/`;
      // On Windows prefer drive-letter paths; on Unix keep legacy order.
      return IS_WINDOWS ? [winPath, unixPath] : [unixPath, winPath];
    }
    return [unixPath];
  }

  function resolve(idx: number, segments: string[]): void {
    if (best) return; // already found a match

    if (idx >= parts.length) {
      for (const p of candidatePaths(segments)) {
        if (fs.existsSync(p)) {
          best = p;
          break;
        }
      }
      return;
    }

    const part = parts[idx];
    if (part === undefined) return;

    // Option 1: treat dash as path separator (new directory)
    resolve(idx + 1, [...segments, part]);
    if (best) return;

    if (segments.length > 0) {
      const last = segments[segments.length - 1]!;
      const rest = segments.slice(0, -1);

      // Option 2: treat dash as dot (e.g. dzcm-test → dzcm.test)
      resolve(idx + 1, [...rest, last + "." + part]);
      if (best) return;

      // Option 3: keep as literal dash (e.g. laravel-contentai)
      resolve(idx + 1, [...rest, last + "-" + part]);
    }
  }

  resolve(0, []);
  if (best) return best;

  if (isDriveSlug && IS_WINDOWS) {
    const drive = firstPart.toUpperCase();
    const rest = parts.slice(1).join("/");
    return rest ? `${drive}:/${rest}` : `${drive}:/`;
  }

  return "/" + slug.replace(/-/g, "/");
}

/**
 * Check if a session's cwd matches or is a subdirectory of targetDir.
 * Returns false for empty session cwds or root `/` target.
 */
export function matchesCwd(sessionCwd: string, targetDir: string): boolean {
  if (!sessionCwd || !targetDir) return false;
  const normTarget = targetDir.replace(/\/+$/, "");
  if (normTarget === "") return false; // guard against root '/'
  const normSession = sessionCwd.replace(/\/+$/, "");
  return normSession === normTarget || normSession.startsWith(normTarget + "/");
}
