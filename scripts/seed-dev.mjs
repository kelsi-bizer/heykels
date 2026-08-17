process.loadEnvFile();
const { PrismaClient } = await import('@prisma/client');
const { PrismaPg } = await import('@prisma/adapter-pg');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const user = await prisma.user.upsert({
  where: { email: 'kelsi@gobizer.com' },
  create: { email: 'kelsi@gobizer.com', name: 'Kelsi Bizer' },
  update: { name: 'Kelsi Bizer' },
});
const token = 'dev-session-token-abc123';
await prisma.session.upsert({
  where: { sessionToken: token },
  create: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 864e5) },
  update: { expires: new Date(Date.now() + 864e5) },
});

// A couple of searches and memory docs so the shell has real data to render.
const s = await prisma.search.create({
  data: { userId: user.id, title: 'Best AI-native search engines in 2026' },
});
await prisma.turn.create({
  data: {
    searchId: s.id,
    query: 'Best AI-native search engines in 2026',
    answer: 'The field split between products that **retrieve** and products that **remember** [1].\n\n### Why it matters\nPersistent context is the axis that actually moved this year [2].',
    sources: [
      { title: 'Google AI docs', url: 'https://ai.google.dev/gemini-api/docs/models' },
      { title: 'The Verge', url: 'https://www.theverge.com/ai-search' },
    ],
    status: 'complete',
  },
});
await prisma.search.create({ data: { userId: user.id, title: 'Q3 planning offsite venues in Austin' } });

await prisma.memoryDoc.upsert({
  where: { userId_path: { userId: user.id, path: 'profile/basics.md' } },
  create: {
    userId: user.id, path: 'profile/basics.md', title: 'Kelsi — basics',
    tags: ['profile'],
    body: '## Summary\nFounder building HeyKels, an AI-native search engine.\n\n## Facts\n- Works at Bizer\n- Prefers concise, technical answers with sources\n\n## Open questions\n- Launch timeline?',
    driveFileId: 'dev-file-1',
  },
  update: {},
});
await prisma.memoryDoc.upsert({
  where: { userId_path: { userId: user.id, path: 'interests/ai-search.md' } },
  create: {
    userId: user.id, path: 'interests/ai-search.md', title: 'AI search & agent tooling',
    tags: ['ai', 'search', 'agents'],
    body: '## Summary\nTracking AI-native search products and how they handle memory.\n\n## Facts\n- Compares products on memory persistence, not answer quality\n- Referenced OpenClaw and Nous Hermes for markdown agent memory',
    driveFileId: 'dev-file-2',
  },
  update: {},
});

console.log('seeded user', user.id);
await prisma.$disconnect();
