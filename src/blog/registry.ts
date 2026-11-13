export interface BlogPostMeta {
  slug: string;
  title: string;
  /** ISO date string, e.g. "2026-05-11" */
  date: string;
  description?: string;
  tags?: string[];
  /** 'markdown' → src/blog/posts/<slug>.md or src/blog/posts/<slug>/index.md
   *  'tsx' → src/blog/posts/<slug>.tsx or src/blog/posts/<slug>/index.tsx */
  type: 'markdown' | 'tsx';
}

/**
 * Add new blog posts here.
 *
 * MARKDOWN POSTS:
 * - Create src/blog/posts/<slug>.md or src/blog/posts/<slug>/index.md
 * - Set type: 'markdown'
 * - For images: place them in src/blog/posts/<slug>/ (e.g., screenshots/, images/)
 *   They'll be synced to public/blog/posts/<slug>/ at dev/build time
 * - Reference images in markdown using RELATIVE paths: ![alt](./screenshots/image.png)
 *   These will be automatically transformed to /blog/posts/<slug>/screenshots/image.png at runtime
 *
 * TSX POSTS:
 * - Create src/blog/posts/<slug>.tsx or src/blog/posts/<slug>/index.tsx with a default export React component
 * - Set type: 'tsx'
 * - Images can be colocated in src/blog/posts/<slug>/ and referenced via public URLs: /blog/posts/<slug>/image.png
 *
 * The sync-blog-images.mjs script (run before dev/build) copies all images and assets
 * from source posts directory to public/blog/posts, excluding .ts/.tsx source files.
 */
export const blogPosts: BlogPostMeta[] = [
  {
    slug: 'ups-wars-utility-science-announcement',
    title: 'UPS Wars: Utility Science Entries Have Opened',
    date: '2026-05-11',
    description: 'Competition entry and form submission details',
    tags: ['ups-wars'],
    type: 'markdown',
  },
  {
    slug: 'fps-limit-impact-on-factorio-ups',
    title: 'Does Limiting FPS Affect Factorio UPS?',
    date: '2026-05-13',
    description: 'A deep dive into FPS limits and their impact on gameplay.',
    tags: ['performance', 'fps', 'ups'],
    type: 'markdown',
  },
];
