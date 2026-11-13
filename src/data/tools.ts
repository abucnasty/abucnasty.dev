export type ToolLinkKind = 'github' | 'app' | 'mod-portal' | 'source';

export interface ToolLink {
  kind: ToolLinkKind;
  label: string; // 'GitHub' | 'Open app' | 'Mod portal' | 'Source'
  url: string;
}

export interface ToolEntry {
  name: string;
  description: string;
  author?: string;
  links: ToolLink[];
}

export interface ToolSection {
  title: string; // 'Benchmarking tools' | 'Utilities' | 'Mods'
  entries: ToolEntry[];
}

export const toolSections: ToolSection[] = [
  {
    title: 'Benchmarking tools',
    entries: [
      {
        name: 'Belt',
        description: 'The CLI benchmarking tool used to run and record Factorio benchmarks.',
        author: 'florishafkenscheid',
        links: [{ kind: 'github', label: 'GitHub', url: 'https://github.com/florishafkenscheid/belt' }],
      },
      {
        name: 'belt-charts',
        description: 'Chart generation tool for visualising Belt benchmark output. Powers the graphics and charts on this site.',
        author: 'abucnasty',
        links: [{ kind: 'github', label: 'GitHub', url: 'https://github.com/abucnasty/belt-charts' }],
      },
    ],
  },
  {
    title: 'Utilities',
    entries: [
      {
        name: 'Clock Generator',
        description: 'A web app for designing and generating Factorio clock blueprint strings for stack inserters',
        author: 'abucnasty',
        links: [
          { kind: 'app', label: 'Open app', url: 'https://clock-generator-self.vercel.app/' },
          { kind: 'github', label: 'GitHub', url: 'https://github.com/abucnasty/factorio-scripts' },
        ],
      },
    ],
  },
  {
    title: 'Mods',
    entries: [
      {
        name: 'Clock Generator Sidecar',
        description: 'Select machines to extract crafting speeds and productivity bonuses. Export data for use with the Clock Generator tool.',
        links: [
          { kind: 'mod-portal', label: 'Mod portal', url: 'https://mods.factorio.com/mod/clock-generator-sidecar' },
          { kind: 'source', label: 'Source', url: 'https://github.com/abucnasty/factorio-scripts' },
        ],
      },
      {
        name: 'Particle Free Disposal',
        description: 'UPS mod that removes all particles related to destroying chests with a railgun.',
        links: [
          { kind: 'mod-portal', label: 'Mod portal', url: 'https://mods.factorio.com/mod/particle_free_disposal' },
          { kind: 'source', label: 'Source', url: 'https://github.com/abucnasty/particle-free-disposal' },
        ],
      },
    ],
  },
];

export interface Tutorial {
  kind: 'guide' | 'video';
  label: string;
  url: string;
}

export const tutorials: Tutorial[] = [
  {
    kind: 'guide',
    label: 'How to Benchmark — written guide',
    url: 'https://github.com/abucnasty/factorio-benchmarks/blob/master/docs/guides/how-to-benchmark.md',
  },
  {
    kind: 'video',
    label: 'How to Benchmark — video walkthrough',
    url: 'https://youtu.be/pXz01Be-9hE',
  },
];
