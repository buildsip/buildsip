import { Frontmatter } from "./validate-frontmatter";

export type Memory = {
  path: string;
  /** Repo or package directory that owns this memory store. */
  project: string;
  frontmatter: Frontmatter;
  body: string;
  /** Filesystem metadata used to detect when cached content must be refreshed. */
  stamp: string;
};
