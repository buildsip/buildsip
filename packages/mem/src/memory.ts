import { Frontmatter } from "./validate-frontmatter";

export type Memory = {
  /** Internal memory.md file path; commands expose its parent directory. */
  path: string;
  /** Repo or package directory that owns this memory store. */
  project: string;
  frontmatter: Frontmatter;
  body: string;
  /** Filesystem metadata used to detect when cached content must be refreshed. */
  stamp: string;
};
