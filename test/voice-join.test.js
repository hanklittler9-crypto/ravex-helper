const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCommand, commands } = require('../src/prefix');
const { ensureConnection } = require('../src/music');
const { commands: slashCommands } = require('../src/commands');

test('parseCommand understands *join', () => {
  assert.deepEqual(parseCommand('*join'), { name: 'join', args: [], argString: '' });
});

test('prefix maps *join and *j to the join handler', () => {
  assert.equal(typeof commands.join, 'function');
  assert.equal(commands.j, commands.join);
  assert.equal(typeof commands.vm, 'function');
});

test('parseCommand understands *vm join', () => {
  const parsed = parseCommand('*vm join');
  assert.equal(parsed.name, 'vm');
  assert.deepEqual(parsed.args, ['join']);
  assert.equal(parsed.argString, 'join');
});

test('ensureConnection tells you to sit in a VC first', async () => {
  const member = {
    voice: {},
    guild: { id: '1', voiceStates: { cache: { get: () => null } } },
  };
  const result = await ensureConnection(member);
  assert.match(result.error, /Join a voice channel first/);
});

test('slash /join is registered', () => {
  assert.ok(slashCommands.some((c) => c.data.name === 'join'));
});
