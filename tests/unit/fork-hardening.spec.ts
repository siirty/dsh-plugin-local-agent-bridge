/**
 * Fork hardening (siirty/dsh-plugin-local-agent-bridge): redaction of common
 * development-Host credentials, a lockout concurrent guesses cannot outrun, and
 * `bypass` failing towards asking when a Profile does not allow it.
 */
import { describe, expect, it } from 'vitest'
import { PrivacyGate } from '../../src/core/privacy.ts'
import { redactText } from '../../src/core/redaction.ts'
import { BridgeSessionEngine } from '../../src/core/session-engine.ts'
import type { BridgePersistence, PersistedBridgeSession } from '../../src/core/persistence.ts'
import type { ProviderTurnRequest } from '../../src/core/provider.ts'
import { FakeProviderAdapter } from '../../src/providers/fake.ts'
import type { BridgePermissionMode, ProviderId } from '../../src/types.ts'

describe('fork redaction additions', () => {
  // Built from parts so this file is not itself a credential-shaped string.
  const samples: Record<string, string> = {
    'GitHub classic token': 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8',
    'GitHub fine-grained token': 'github_pat_' + '11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ',
    'JWT / Supabase key': 'eyJ' + 'hbGciOiJIUzI1NiJ9' + '.eyJ' + 'yb2xlIjoic2VydmljZV9yb2xlIn0' + '.' + 'c2lnbmF0dXJlLXBhcnQ',
    'AWS access key id': 'AKIA' + 'ABCDEFGHIJKLMNOP',
    'Slack token': 'xoxb-' + '123456789012-abcdefghij',
    'Stripe restricted key': 'rk_live_' + 'abcdefghijklmnop1234',
  }

  for (const [name, secret] of Object.entries(samples)) {
    it(`redacts a ${name}`, () => {
      const out = redactText(`before ${secret} after`)
      expect(out).not.toContain(secret)
      expect(out).toContain('[REDACTED]')
      expect(out.startsWith('before ')).toBe(true)
    })
  }

  it('redacts a PEM private key block, including an unterminated one', () => {
    const begin = '-----BEGIN OPENSSH ' + 'PRIVATE KEY-----'
    const end = '-----END OPENSSH ' + 'PRIVATE KEY-----'
    expect(redactText(`x\n${begin}\nAAAAB3Nza\n${end}\ny`)).toBe('x\n[REDACTED]\ny')
    expect(redactText(`x\n${begin}\nAAAAB3Nza`)).toBe('x\n[REDACTED]')
  })

  it('leaves ordinary code alone', () => {
    const code = 'const ghost = github.repos.get(); // eyJ is not a token on its own'
    expect(redactText(code)).toBe(code)
  })
})

describe('fork privacy gate serialisation', () => {
  it('locks out the sixth guess even when every guess is sent at once', async () => {
    const gate = new PrivacyGate(
      { absoluteTimeoutMs: 60_000, idleTimeoutMs: 10_000, minPasswordLength: 8 },
      null,
      async () => {},
    )
    await gate.setPassword(null, 'correct-horse')
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => gate.unlock('wrong-horse')),
    )
    const codes = results.map(result => result.status === 'rejected'
      ? (result.reason as { code?: string }).code
      : 'unlocked')
    expect(codes.slice(0, 5)).toEqual(Array(5).fill('PASSWORD_REJECTED'))
    expect(codes.slice(5)).toEqual(Array(7).fill('PASSWORD_ATTEMPTS_EXCEEDED'))
    // And the right password is still turned away while the lockout stands.
    await expect(gate.unlock('correct-horse')).rejects.toMatchObject({ code: 'PASSWORD_ATTEMPTS_EXCEEDED' })
  })
})

class MemoryPersistence {
  private readonly records = new Map<string, PersistedBridgeSession>()
  list(): PersistedBridgeSession[] { return [...this.records.values()].map(record => structuredClone(record)) }
  async put(record: PersistedBridgeSession): Promise<void> { this.records.set(record.bridgeSessionId, structuredClone(record)) }
  async close(): Promise<void> {}
}

class RecordingAdapter extends FakeProviderAdapter {
  readonly modes: BridgePermissionMode[] = []
  override async startTurn(request: ProviderTurnRequest): Promise<void> {
    this.modes.push(request.hooks.permissionMode)
    await super.startTurn(request)
  }
}

async function runOneTurn(allowBypassMode: boolean | undefined): Promise<BridgePermissionMode[]> {
  const workspace = { id: 'workspace-1', title: 'Fixture', cwd: process.cwd(), status: 'ok' as const }
  const adapter = new RecordingAdapter()
  const engine = await BridgeSessionEngine.create({
    persistence: new MemoryPersistence() as unknown as BridgePersistence,
    providers: new Map<ProviderId, FakeProviderAdapter>([['fake', adapter]]),
    resolveWorkspace: async id => id === workspace.id ? workspace : undefined,
    longPollMaxMs: 100,
    ...(allowBypassMode === undefined ? {} : { allowBypassMode }),
  })
  const session = await engine.createSession({ providerId: 'fake', workspaceId: workspace.id, permissionMode: 'bypass' })
  await engine.send(session.bridgeSessionId, 'hello')
  const deadline = Date.now() + 5_000
  while (adapter.modes.length === 0 && Date.now() < deadline) {
    await new Promise(resolve => { setTimeout(resolve, 10) })
  }
  await engine.dispose()
  return adapter.modes
}

describe('fork bypass guard', () => {
  it('runs a session stored as bypass as manual when bypass is not allowed', async () => {
    expect(await runOneTurn(false)).toEqual(['manual'])
  })

  it('keeps upstream behaviour when the engine is not told otherwise', async () => {
    expect(await runOneTurn(undefined)).toEqual(['bypass'])
  })
})
