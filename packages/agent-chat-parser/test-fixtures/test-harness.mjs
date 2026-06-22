#!/usr/bin/env node
/**
 * Integration test harness for cli-continues parsers.
 *
 * Imports each parser's parse + extract functions from the compiled dist/
 * and validates they return expected data against the test fixtures.
 *
 * Prerequisites:
 *   - Fixtures must be symlinked to expected paths (test-all.sh handles this)
 *   - Project must be built (`npx tsc -b`)
 *
 * Usage:  node test-fixtures/test-harness.mjs
 */

import { parseAmpSessions, extractAmpContext } from '../dist/parsers/amp.js';
import { parseClineSessions, extractClineContext, parseRooCodeSessions, extractRooCodeContext, parseKiloCodeSessions, extractKiloCodeContext } from '../dist/parsers/cline.js';
import { parseCrushSessions, extractCrushContext } from '../dist/parsers/crush.js';
import { parseAntigravitySessions, extractAntigravityContext } from '../dist/parsers/antigravity.js';
import { parseKiroSessions, extractKiroContext } from '../dist/parsers/kiro.js';

// ── Test Tracking ───────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  ❌ ${label}`);
  }
}

function section(name) {
  console.log(`\n━━━ ${name} ${'━'.repeat(Math.max(0, 60 - name.length))}`);
}

// ── Amp Tests ───────────────────────────────────────────────────────────────

async function testAmp() {
  section('Amp Parser');

  const sessions = await parseAmpSessions();
  assert(sessions.length >= 1, `Found ${sessions.length} Amp session(s) (expected ≥1)`);

  if (sessions.length === 0) return;

  // Find our main test thread
  const main = sessions.find(s => s.id === 'test-thread-1');
  assert(!!main, 'Found test-thread-1');

  if (!main) return;

  assert(main.source === 'amp', `source = "${main.source}" (expected "amp")`);
  assert(main.summary?.includes('login form'), `summary contains "login form": "${main.summary?.slice(0, 50)}"`);
  assert(main.model === 'claude-sonnet-4-20250514', `model = "${main.model}"`);
  assert(main.createdAt instanceof Date && !isNaN(main.createdAt.getTime()), 'createdAt is valid Date');
  assert(main.lines > 0, `lines = ${main.lines} (>0)`);
  assert(main.bytes > 0, `bytes = ${main.bytes} (>0)`);

  // Extract context
  const ctx = await extractAmpContext(main);
  assert(ctx.recentMessages.length >= 2, `recentMessages.length = ${ctx.recentMessages.length} (≥2)`);
  assert(ctx.recentMessages.some(m => m.role === 'user'), 'Has user messages');
  assert(ctx.recentMessages.some(m => m.role === 'assistant'), 'Has assistant messages');

  // Token usage from usageLedger (excludes title-generation)
  assert(!!ctx.sessionNotes?.tokenUsage, 'Has tokenUsage');
  if (ctx.sessionNotes?.tokenUsage) {
    // 3 conversation events: 150+350+500 = 1000 input, 200+450+300 = 950 output
    assert(ctx.sessionNotes.tokenUsage.input === 1000,
      `tokenUsage.input = ${ctx.sessionNotes.tokenUsage.input} (expected 1000)`);
    assert(ctx.sessionNotes.tokenUsage.output === 950,
      `tokenUsage.output = ${ctx.sessionNotes.tokenUsage.output} (expected 950)`);
  }

  // Pending tasks from last assistant message
  assert(ctx.pendingTasks.length >= 1, `pendingTasks.length = ${ctx.pendingTasks.length} (≥1)`);
  assert(typeof ctx.markdown === 'string' && ctx.markdown.length > 0, 'markdown is non-empty');

  // Edge case thread (empty content blocks, no usage events)
  const edge = sessions.find(s => s.id === 'test-thread-edge');
  assert(!!edge, 'Found test-thread-edge (edge case)');
  if (edge) {
    // Should have a summary from the first user message
    assert(!!edge.summary, `Edge thread has summary: "${edge.summary?.slice(0, 40)}"`);
  }
}

// ── Cline Tests ─────────────────────────────────────────────────────────────

async function testCline() {
  section('Cline Parser');

  const sessions = await parseClineSessions();
  // parseClineSessions returns ALL cline-family sessions (cline + roo-code + kilo-code)
  const clineSessions = sessions.filter(s => s.source === 'cline');
  assert(clineSessions.length >= 1, `Found ${clineSessions.length} Cline session(s) (expected ≥1)`);

  if (clineSessions.length === 0) return;

  const main = clineSessions[0];
  assert(main.source === 'cline', `source = "${main.source}"`);
  assert(!!main.summary, `summary = "${main.summary?.slice(0, 50)}"`);
  assert(main.createdAt instanceof Date, 'createdAt is valid Date');

  // Extract context
  const ctx = await extractClineContext(main);
  assert(ctx.recentMessages.length >= 2, `recentMessages.length = ${ctx.recentMessages.length} (≥2)`);
  assert(ctx.recentMessages.some(m => m.role === 'user'), 'Has user messages');

  // Token usage from api_req_started events
  assert(!!ctx.sessionNotes?.tokenUsage, 'Has tokenUsage');
  if (ctx.sessionNotes?.tokenUsage) {
    assert(ctx.sessionNotes.tokenUsage.input > 0, `tokenUsage.input = ${ctx.sessionNotes.tokenUsage.input} (>0)`);
    assert(ctx.sessionNotes.tokenUsage.output > 0, `tokenUsage.output = ${ctx.sessionNotes.tokenUsage.output} (>0)`);
  }

  // Cache tokens
  assert(!!ctx.sessionNotes?.cacheTokens, 'Has cacheTokens');

  // Reasoning highlights
  assert(Array.isArray(ctx.sessionNotes?.reasoning) && ctx.sessionNotes.reasoning.length >= 1,
    `reasoning highlights = ${ctx.sessionNotes?.reasoning?.length ?? 0} (≥1)`);

  // Pending tasks from completion_result
  assert(ctx.pendingTasks.length >= 1, `pendingTasks.length = ${ctx.pendingTasks.length} (≥1)`);

  assert(typeof ctx.markdown === 'string' && ctx.markdown.length > 0, 'markdown is non-empty');
}

// ── Roo Code Tests ──────────────────────────────────────────────────────────

async function testRooCode() {
  section('Roo Code Parser');

  const sessions = await parseRooCodeSessions();
  assert(sessions.length >= 1, `Found ${sessions.length} Roo Code session(s) (expected ≥1)`);

  if (sessions.length === 0) return;

  const main = sessions[0];
  assert(main.source === 'roo-code', `source = "${main.source}"`);
  assert(!!main.summary, `summary = "${main.summary?.slice(0, 50)}"`);

  const ctx = await extractRooCodeContext(main);
  assert(ctx.recentMessages.length >= 2, `recentMessages.length = ${ctx.recentMessages.length} (≥2)`);
  assert(typeof ctx.markdown === 'string' && ctx.markdown.length > 0, 'markdown is non-empty');
}

// ── Kilo Code Tests ─────────────────────────────────────────────────────────

async function testKiloCode() {
  section('Kilo Code Parser');

  const sessions = await parseKiloCodeSessions();
  assert(sessions.length >= 1, `Found ${sessions.length} Kilo Code session(s) (expected ≥1)`);

  if (sessions.length === 0) return;

  const main = sessions[0];
  assert(main.source === 'kilo-code', `source = "${main.source}"`);
  assert(!!main.summary, `summary = "${main.summary?.slice(0, 50)}"`);

  const ctx = await extractKiloCodeContext(main);
  assert(ctx.recentMessages.length >= 2, `recentMessages.length = ${ctx.recentMessages.length} (≥2)`);
  assert(typeof ctx.markdown === 'string' && ctx.markdown.length > 0, 'markdown is non-empty');
}

// ── Crush Tests ─────────────────────────────────────────────────────────────

async function testCrush() {
  section('Crush Parser');

  const sessions = await parseCrushSessions();
  assert(sessions.length >= 1, `Found ${sessions.length} Crush session(s) (expected ≥1)`);

  if (sessions.length === 0) return;

  // Should find test-session-1 (has title "Build API endpoint")
  const main = sessions.find(s => s.id === 'test-session-1');
  assert(!!main, 'Found test-session-1');

  if (!main) return;

  assert(main.source === 'crush', `source = "${main.source}"`);
  assert(main.summary?.includes('Build API endpoint') || main.summary?.includes('REST API'),
    `summary = "${main.summary?.slice(0, 50)}"`);
  assert(main.lines > 0, `lines = ${main.lines} (>0)`);

  // Extract context
  const ctx = await extractCrushContext(main);
  assert(ctx.recentMessages.length >= 2, `recentMessages.length = ${ctx.recentMessages.length} (≥2)`);
  assert(ctx.recentMessages.some(m => m.role === 'user'), 'Has user messages');
  assert(ctx.recentMessages.some(m => m.role === 'assistant'), 'Has assistant messages');

  // Token usage from sessions table
  assert(!!ctx.sessionNotes?.tokenUsage, 'Has tokenUsage');
  if (ctx.sessionNotes?.tokenUsage) {
    assert(ctx.sessionNotes.tokenUsage.input === 1500,
      `tokenUsage.input = ${ctx.sessionNotes.tokenUsage.input} (expected 1500)`);
    assert(ctx.sessionNotes.tokenUsage.output === 2200,
      `tokenUsage.output = ${ctx.sessionNotes.tokenUsage.output} (expected 2200)`);
  }

  // Model from message rows
  assert(ctx.sessionNotes?.model === 'claude-sonnet-4',
    `model = "${ctx.sessionNotes?.model}" (expected "claude-sonnet-4")`);

  assert(typeof ctx.markdown === 'string' && ctx.markdown.length > 0, 'markdown is non-empty');

  // Edge case: session with null title should use first user message
  const edge = sessions.find(s => s.id === 'test-session-edge');
  assert(!!edge, 'Found test-session-edge');
  if (edge) {
    assert(!!edge.summary, `Edge session has summary from first message: "${edge.summary?.slice(0, 40)}"`);
  }

  // Edge case: session with empty parts
  const empty = sessions.find(s => s.id === 'test-session-empty');
  assert(!!empty, 'Found test-session-empty');
}

// ── Kiro Tests ──────────────────────────────────────────────────────────────

async function testKiro() {
  section('Kiro Parser');

  const sessions = await parseKiroSessions();
  assert(sessions.length >= 1, `Found ${sessions.length} Kiro session(s) (expected ≥1)`);

  if (sessions.length === 0) return;

  const main = sessions.find(s => s.id === 'test-session-1');
  assert(!!main, 'Found test-session-1');

  if (!main) return;

  assert(main.source === 'kiro', `source = "${main.source}"`);
  assert(!!main.summary, `summary = "${main.summary?.slice(0, 50)}"`);
  assert(main.model === 'claude-sonnet-4-20250514', `model = "${main.model}"`);

  // Extract context
  const ctx = await extractKiroContext(main);
  assert(ctx.recentMessages.length >= 2, `recentMessages.length = ${ctx.recentMessages.length} (≥2)`);
  assert(ctx.recentMessages.some(m => m.role === 'user'), 'Has user messages');
  assert(ctx.recentMessages.some(m => m.role === 'assistant'), 'Has assistant messages');

  assert(typeof ctx.markdown === 'string' && ctx.markdown.length > 0, 'markdown is non-empty');

  // Edge case: test-session-edge has array content format
  const edge = sessions.find(s => s.id === 'test-session-edge');
  assert(!!edge, 'Found test-session-edge (array content format)');
  if (edge) {
    const edgeCtx = await extractKiroContext(edge);
    assert(edgeCtx.recentMessages.length >= 2,
      `Edge session recentMessages.length = ${edgeCtx.recentMessages.length} (≥2)`);
  }
}

// ── Antigravity Tests ───────────────────────────────────────────────────────

async function testAntigravity() {
  section('Antigravity Parser');

  const sessions = await parseAntigravitySessions();
  assert(sessions.length >= 1, `Found ${sessions.length} Antigravity session(s) (expected ≥1)`);

  if (sessions.length === 0) return;

  // Should find at least the session.jsonl file
  const main = sessions.find(s => s.id === 'session');
  assert(!!main, 'Found session.jsonl');

  if (!main) return;

  assert(main.source === 'antigravity', `source = "${main.source}"`);
  assert(!!main.summary, `summary = "${main.summary?.slice(0, 50)}"`);
  assert(main.repo === 'test-project', `repo = "${main.repo}" (expected "test-project")`);
  assert(main.lines > 0, `lines = ${main.lines} (>0)`);

  // Extract context
  const ctx = await extractAntigravityContext(main);
  assert(ctx.recentMessages.length >= 2, `recentMessages.length = ${ctx.recentMessages.length} (≥2)`);
  assert(ctx.recentMessages.some(m => m.role === 'user'), 'Has user messages');
  assert(ctx.recentMessages.some(m => m.role === 'assistant'), 'Has assistant messages');

  assert(typeof ctx.markdown === 'string' && ctx.markdown.length > 0, 'markdown is non-empty');

  // Binary-prefix session should also parse (session-binary.jsonl has blank lines)
  const binary = sessions.find(s => s.id === 'session-binary');
  assert(!!binary, 'Found session-binary.jsonl (binary prefix test)');
  if (binary) {
    const bCtx = await extractAntigravityContext(binary);
    assert(bCtx.recentMessages.length >= 2,
      `Binary session recentMessages.length = ${bCtx.recentMessages.length} (≥2)`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         cli-continues Parser Integration Tests              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  await testAmp();
  await testCline();
  await testRooCode();
  await testKiloCode();
  await testCrush();
  await testKiro();
  await testAntigravity();

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);

  if (failures.length > 0) {
    console.log('\nFailed tests:');
    for (const f of failures) {
      console.log(`  ❌ ${f}`);
    }
  }

  console.log('══════════════════════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});
