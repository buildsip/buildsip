/**
 * Well-known file and directory names we look for on disk.
 * Keep every search/write of these names on this enum so a typo cannot invent a second path.
 */
export enum NAMES {
  /** Marks a package directory that can own a memory store. */
  PACKAGE_JSON = "package.json",
  /** Marks a Git working-tree root. This is a directory in a normal clone and a file in a worktree. */
  GIT = ".git",
  /** Memory store directory. Only allowed at a package root or the repo root. */
  MEMORIES = ".memories",
  /** Store settings file inside `.memories`. */
  CONFIG_JSON = "config.json",
  /** Folder of memory.md files and attachments, created on the first insert. */
  DATA = "data",
  /** The markdown file that holds one memory. */
  MEMORY_MD = "memory.md",
  /** Dependency installs and Git internals; never treated as a package store. */
  NODE_MODULES = "node_modules",
  /** Editor folder at the Git root, used for memory tab labels. */
  VSCODE = ".vscode",
  /** Cursor / VS Code settings that receive the memory.md tab-label pattern. */
  SETTINGS_JSON = "settings.json",
  /** Prefix for temporary memory directories and staged writes. */
  MEM_PREFIX = ".mem-",
}
