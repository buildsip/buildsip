import { isAbsolute, posix } from "node:path";

/**
 * Normalizes separators and removes duplicate repo-relative scopes.
 * Scopes are literal file or directory paths; * means the whole repo.
 */
export function normalizeScopes(scopes: string[]) {
  if (!scopes.length)
    throw new Error(
      'Provide at least one repository-relative file or directory path, or "*" for the whole repo.',
    );
  return [
    ...new Set(
      scopes.map((scope) => {
        // Store / on every OS, even when the caller supplied Windows separators.
        const path = scope.replaceAll("\\", "/").replace(/\/+$/, "");
        if (
          !path.trim() ||
          isAbsolute(path) ||
          /^[a-z]:/i.test(path) ||
          path.startsWith("!") ||
          path.split("/").includes("..") ||
          path.includes("\0")
        ) {
          throw new Error(
            `Invalid scope: ${JSON.stringify(scope)}. Use a nonempty repository-relative file or directory path. Use "*" for the whole repo; absolute paths, exclusions, and .. are not allowed.`,
          );
        }
        // Brackets and parentheses stay literal so Next.js routes like (auth)/[id] work.
        if (path !== "*" && /[*?]/.test(path)) {
          throw new Error(
            `Globs are not supported in scope ${JSON.stringify(scope)}. Use a repository-relative file or directory path, such as apps/web/auth instead of apps/web/auth/**/*; directories include all descendants. List multiple paths to select separate areas, or use "*" for the whole repo.`,
          );
        }
        // Collapse ./ and repeated slashes without turning a repo-relative scope absolute.
        return posix.normalize(path);
      }),
    ),
  ];
}
