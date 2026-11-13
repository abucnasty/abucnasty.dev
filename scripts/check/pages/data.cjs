// Checks on the generated content index. Opens no page.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..', '..');
const generatedDir = path.join(root, 'src', 'generated', 'benchmarks');

const questionHeading = /^ {0,3}#{1,4}[ \t]+(?:the[ \t]+)?question[ \t]*:?[ \t]*#*[ \t]*$/im;
const answerHeading = /^ {0,3}#{1,4}[ \t]+(?:the[ \t]+)?answer[ \t]*:?[ \t]*#*[ \t]*$/im;

/** One-line teaser text: 1-281 characters, starts with a capital or digit, no markdown left over. */
function problemWithLine(text) {
  if (typeof text !== 'string') return 'not a string';
  if (text.length < 1 || text.length > 281) return `length ${text.length}`;
  if (!/^[\p{Lu}\d]/u.test(text)) return 'does not start with an upper-case letter or digit';
  if (text.includes('`')) return 'contains a backtick';
  if (text.includes('**')) return 'contains **';
  if (text.includes('](')) return 'contains ](';
  if (/[\r\n]/.test(text)) return 'contains a newline';
  if (text.startsWith('- ')) return 'starts with "- "';
  return null;
}

module.exports = {
  name: 'data',
  async run({ expect, data }) {
    const list = data.index.benchmarks;
    const file = (b, name) => path.join(generatedDir, b.slug, name);

    for (const field of ['question', 'finding']) {
      const bad = list
        .filter((b) => b[field] !== undefined)
        .map((b) => [b.slug, problemWithLine(b[field])])
        .filter(([, p]) => p);
      expect(
        `every ${field} is one clean line (1-281 characters, no markdown)`,
        bad.length === 0,
        bad.map(([s, p]) => `${s}: ${p}`).join(' | '),
      );
    }

    expect(
      'a benchmark has question.md exactly when it has a question',
      list.every((b) => fs.existsSync(file(b, 'question.md')) === Boolean(b.question)),
      list.filter((b) => fs.existsSync(file(b, 'question.md')) !== Boolean(b.question)).map((b) => b.slug).join(','),
    );

    const withAnswer = list.filter((b) => fs.existsSync(file(b, 'answer.md')));
    expect(
      'where answer.md exists, question.md exists',
      withAnswer.every((b) => fs.existsSync(file(b, 'question.md'))),
      withAnswer.filter((b) => !fs.existsSync(file(b, 'question.md'))).map((b) => b.slug).join(','),
    );

    const findings = list.filter((b) => b.finding !== undefined);
    expect(
      'no finding ends with a colon',
      findings.every((b) => !b.finding.endsWith(':')),
      findings.filter((b) => b.finding.endsWith(':')).map((b) => b.slug).join(','),
    );
    expect(
      'every finding is at least 12 characters',
      findings.every((b) => b.finding.length >= 12),
      findings.filter((b) => b.finding.length < 12).map((b) => `${b.slug}: ${b.finding}`).join(' | '),
    );

    const leftOver = [];
    for (const b of list) {
      const readme = file(b, 'README.md');
      if (!fs.existsSync(readme)) continue;
      const text = fs.readFileSync(readme, 'utf8');
      if (fs.existsSync(file(b, 'question.md')) && questionHeading.test(text)) leftOver.push(`${b.slug}: question`);
      if (fs.existsSync(file(b, 'answer.md')) && answerHeading.test(text)) leftOver.push(`${b.slug}: answer`);
    }
    expect('no generated README still has a heading that was lifted', leftOver.length === 0, leftOver.join(' | '));

    const topics = data.index.topics;
    expect('index has a topics list', Array.isArray(topics));
    const ids = new Set((topics ?? []).map((t) => t.id));
    const withTopic = list.filter((b) => b.topic !== undefined);
    expect(
      'topic counts add up to the number of benchmarks with a topic',
      (topics ?? []).reduce((sum, t) => sum + t.count, 0) === withTopic.length,
      `counts=${(topics ?? []).reduce((sum, t) => sum + t.count, 0)} benchmarks=${withTopic.length}`,
    );
    expect(
      'every benchmark topic is a listed topic id',
      withTopic.every((b) => ids.has(b.topic)),
      withTopic.filter((b) => !ids.has(b.topic)).map((b) => `${b.slug}: ${b.topic}`).join(' | '),
    );
    expect(
      'each topic count matches its benchmarks',
      (topics ?? []).every((t) => t.count === list.filter((b) => b.topic === t.id).length),
    );

    const expectedCounts = { inserters: 12, science: 12, mining: 8, engine: 6, vehicles: 3, space: 2 };
    const untopiced = list.filter((b) => !b.topic).map((b) => b.slug);
    expect('every benchmark has a topic', untopiced.length === 0, untopiced.join(','));
    const countsOk =
      (topics ?? []).length === Object.keys(expectedCounts).length &&
      Object.entries(expectedCounts).every(([id, n]) => (topics ?? []).find((t) => t.id === id)?.count === n);
    expect(
      'index has six topics with the counts from topics.md',
      countsOk,
      (topics ?? []).map((t) => `${t.id}=${t.count}`).join(', '),
    );

    // Blueprints are fetched live by the browser: nothing about them is generated at build time.
    const generatedRoot = path.join(root, 'src', 'generated');
    const stale = ['blueprints.json', 'blueprints.md'].filter((f) => fs.existsSync(path.join(generatedRoot, f)));
    expect('sync writes no blueprint data', stale.length === 0, stale.join(','));
    expect(
      'topics carry only id, label and count',
      (topics ?? []).every((t) => JSON.stringify(Object.keys(t).sort()) === '["count","id","label"]'),
      (topics ?? []).map((t) => Object.keys(t).join('+')).join(' | '),
    );
  },
};
