import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config';
import { createFixedClock } from '../../src/lib/time';
import { createMailer, escapeHtml, FileMailer, mailTemplates, NoopMailer, renderText, SmtpMailer } from '../../src/mail';
import { testEnv } from '../helpers';

describe('NoopMailer', () => {
  it('collects messages for assertions', async () => {
    const mailer = new NoopMailer();
    expect(mailer.transport).toBe('noop');
    await mailer.send({ to: 'a@example.test', subject: 'first', text: 'hello' });
    await mailer.send({ to: 'b@example.test', subject: 'second', text: 'hi', html: '<p>hi</p>' });
    await mailer.send({ to: 'a@example.test', subject: 'third', text: 'again' });
    expect(mailer.sent).toHaveLength(3);
    expect(mailer.lastTo('a@example.test')?.subject).toBe('third');
    expect(mailer.lastTo('nobody@example.test')).toBeUndefined();
    // Stored copies are detached from the caller's object.
    const message = { to: 'c@example.test', subject: 'mutable', text: 'x' };
    await mailer.send(message);
    message.subject = 'changed';
    expect(mailer.sent[3]?.subject).toBe('mutable');
    mailer.clear();
    expect(mailer.sent).toEqual([]);
    await mailer.close();
  });

  it('rejects header injection and invalid recipients', async () => {
    const mailer = new NoopMailer();
    await expect(mailer.send({ to: 'a@example.test\r\nBcc: victim@example.test', subject: 's', text: 't' })).rejects.toThrow(TypeError);
    await expect(mailer.send({ to: 'a@example.test', subject: 'hello\nX-Injected: 1', text: 't' })).rejects.toThrow(TypeError);
    await expect(mailer.send({ to: '', subject: 's', text: 't' })).rejects.toThrow(TypeError);
    await expect(mailer.send({ to: `${'a'.repeat(320)}@x`, subject: 's', text: 't' })).rejects.toThrow(TypeError);
    await expect(mailer.send({ to: 'a@example.test', subject: 's'.repeat(999), text: 't' })).rejects.toThrow(TypeError);
    expect(mailer.sent).toEqual([]);
  });
});

describe('FileMailer', () => {
  let dir: string;

  beforeEach(async () => {
    dir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'scpsl-trust-mail-')), 'outbox');
  });

  afterEach(async () => {
    await fs.rm(path.dirname(dir), { recursive: true, force: true });
  });

  it('writes an .eml and a .json file per message into a private directory', async () => {
    const clock = createFixedClock('2026-09-29T15:42:20.123Z');
    const mailer = new FileMailer(dir, 'Trust <no-reply@example.test>', clock);
    expect(mailer.transport).toBe('file');
    await mailer.send({ to: 'alice@example.test', subject: 'Verify <you>', text: 'Plain body\nline 2', html: '<p>HTML body</p>' });
    await mailer.send({ to: 'bob@example.test', subject: 'Second', text: 'x' });

    const files = (await fs.readdir(dir)).sort();
    expect(files).toHaveLength(4);
    expect(files.filter((f) => f.endsWith('.eml'))).toHaveLength(2);
    expect(files.filter((f) => f.endsWith('.json'))).toHaveLength(2);
    for (const file of files) expect(file).toMatch(/^2026-09-29T15-42-20-123Z-[0-9a-f]{8}\.(eml|json)$/);
    expect((await fs.stat(dir)).mode & 0o777).toBe(0o700);

    const jsonFile = files.find((f) => f.endsWith('.json'));
    const summaries = await Promise.all(
      files.filter((f) => f.endsWith('.json')).map(async (f) => JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')) as Record<string, unknown>),
    );
    const alice = summaries.find((s) => s['to'] === 'alice@example.test');
    expect(alice).toEqual({
      from: 'Trust <no-reply@example.test>',
      to: 'alice@example.test',
      subject: 'Verify <you>',
      text: 'Plain body\nline 2',
      html: '<p>HTML body</p>',
      sent_at: '2026-09-29T15:42:20.123Z',
    });
    expect((await fs.stat(path.join(dir, jsonFile ?? ''))).mode & 0o777).toBe(0o600);

    const emls = await Promise.all(files.filter((f) => f.endsWith('.eml')).map((f) => fs.readFile(path.join(dir, f), 'utf8')));
    const aliceEml = emls.find((e) => e.includes('alice@example.test'));
    expect(aliceEml).toMatch(/^From: Trust <no-reply@example.test>/m);
    expect(aliceEml).toMatch(/^To: alice@example.test/m);
    expect(aliceEml).toMatch(/^Subject: Verify <you>/m);
    expect(aliceEml).toContain('Plain body');
    expect(aliceEml).toContain('<p>HTML body</p>');
    await mailer.close();
  });

  it('rejects header injection before writing anything', async () => {
    const mailer = new FileMailer(dir, 'no-reply@example.test');
    await expect(mailer.send({ to: 'a@example.test\nBcc: b@example.test', subject: 's', text: 't' })).rejects.toThrow(TypeError);
    await expect(fs.readdir(dir)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('createMailer', () => {
  it('selects the transport from the configuration', async () => {
    const noop = createMailer(loadConfig(testEnv({ MAIL_TRANSPORT: 'noop' })));
    expect(noop).toBeInstanceOf(NoopMailer);
    const file = createMailer(loadConfig(testEnv({ MAIL_TRANSPORT: 'file', MAIL_FILE_DIR: os.tmpdir() })));
    expect(file).toBeInstanceOf(FileMailer);
    // Constructing the SMTP transport does not connect.
    const smtp = createMailer(loadConfig(testEnv({ MAIL_TRANSPORT: 'smtp', SMTP_URL: 'smtp://user:pass@localhost:2525', MAIL_FROM: 'x@example.test' })));
    expect(smtp).toBeInstanceOf(SmtpMailer);
    expect(smtp.transport).toBe('smtp');
    await Promise.all([noop.close(), file.close(), smtp.close()]);
  });
});

describe('templates', () => {
  it('escapes HTML and substitutes placeholders in a single pass', () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;');
    expect(renderText('Hi {name}, {unknown} {name}', { name: '{other}', other: 'X' })).toBe('Hi {other}, {unknown} {other}');
  });

  it('renders verification and reset mails with escaped HTML and plain-text links', () => {
    const input = {
      to: 'alice@example.test',
      username: '<script>alert(1)</script>',
      actionUrl: 'https://trust.example.test/verify?token=abc&x=1',
      expiresInText: '24 hours',
    };
    const verify = mailTemplates.emailVerification(input);
    expect(verify.to).toBe(input.to);
    expect(verify.subject).toBe('SCP:SL Trust Network: verify your e-mail address');
    expect(verify.text).toContain('Hello <script>alert(1)</script>,');
    expect(verify.text).toContain('Verify e-mail address: https://trust.example.test/verify?token=abc&x=1');
    expect(verify.text).toContain('expires in 24 hours');
    expect(verify.html).not.toContain('<script>');
    expect(verify.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(verify.html).toContain('href="https://trust.example.test/verify?token=abc&amp;x=1"');

    const reset = mailTemplates.passwordReset(input);
    expect(reset.subject).toBe('SCP:SL Trust Network: reset your password');
    expect(reset.text).toContain('Choose a new password: https://trust.example.test/verify?token=abc&x=1');
    expect(reset.text).toContain('your password stays unchanged');

    const note = mailTemplates.notification('bob@example.test', 'Case update', 'Line 1 <b>\nLine 2');
    expect(note.subject).toBe('SCP:SL Trust Network: Case update');
    expect(note.text).toContain('Line 1 <b>\nLine 2');
    expect(note.html).toContain('Line 1 &lt;b&gt;<br>Line 2');
  });
});
