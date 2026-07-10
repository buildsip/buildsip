export type Alias = {
  root: string;
  aliases: string[];
};

export type BuildSipConfig = {
  projects: Alias[];
};
