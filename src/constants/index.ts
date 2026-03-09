export const GITHUB_API_BASE = 'https://api.github.com';

export const EXAMPLE_REPOS = [
  { owner: 'facebook', repo: 'react', description: 'A JavaScript library for building user interfaces' },
  { owner: 'vercel', repo: 'next.js', description: 'The React Framework' },
  { owner: 'microsoft', repo: 'typescript', description: 'TypeScript is a superset of JavaScript' },
  { owner: 'tailwindlabs', repo: 'tailwindcss', description: 'A utility-first CSS framework' },
  { owner: 'denoland', repo: 'deno', description: 'A modern runtime for JavaScript and TypeScript' },
] as const;

export const RATE_LIMIT_WARNING_THRESHOLD = 20;
