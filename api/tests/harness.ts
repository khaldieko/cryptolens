/**
 * Minimal zero-dependency test runner for the API.
 *
 * Deliberate choice: the project already carries tsx, so a tiny runner keeps
 * the dependency surface small while still giving describe/it structure,
 * assertions, and a proper non-zero exit code for CI.
 */

type Fn = () => void | Promise<void>;

interface Case { name: string; fn: Fn; }
interface Suite { name: string; cases: Case[]; }

const suites: Suite[] = [];
let current: Suite | null = null;

export function describe(name: string, fn: () => void) {
  current = { name, cases: [] };
  suites.push(current);
  fn();
  current = null;
}

export function it(name: string, fn: Fn) {
  if (!current) throw new Error("it() must be called inside describe()");
  current.cases.push({ name, fn });
}

/* ---------- assertions ---------- */

export const expect = (actual: unknown) => ({
  toBe(expected: unknown) {
    if (!Object.is(actual, expected)) {
      throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  },
  toEqual(expected: unknown) {
    const a = JSON.stringify(actual), b = JSON.stringify(expected);
    if (a !== b) throw new Error(`expected ${b}, got ${a}`);
  },
  toBeCloseTo(expected: number, precision = 2) {
    const diff = Math.abs((actual as number) - expected);
    if (diff > Math.pow(10, -precision) / 2) {
      throw new Error(`expected ~${expected}, got ${actual}`);
    }
  },
  toBeTruthy() { if (!actual) throw new Error(`expected truthy, got ${JSON.stringify(actual)}`); },
  toBeFalsy() { if (actual) throw new Error(`expected falsy, got ${JSON.stringify(actual)}`); },
  toBeGreaterThan(n: number) {
    if (!((actual as number) > n)) throw new Error(`expected > ${n}, got ${actual}`);
  },
  toBeLessThan(n: number) {
    if (!((actual as number) < n)) throw new Error(`expected < ${n}, got ${actual}`);
  },
  toHaveLength(n: number) {
    const len = (actual as { length: number })?.length;
    if (len !== n) throw new Error(`expected length ${n}, got ${len}`);
  },
  toContain(needle: string) {
    if (!String(actual).includes(needle)) {
      throw new Error(`expected "${actual}" to contain "${needle}"`);
    }
  },
});

/* ---------- runner ---------- */

export async function run(): Promise<number> {
  let passed = 0, failed = 0;
  const failures: string[] = [];

  for (const suite of suites) {
    console.log(`\n  ${suite.name}`);
    for (const c of suite.cases) {
      try {
        await c.fn();
        passed++;
        console.log(`    ✓ ${c.name}`);
      } catch (err) {
        failed++;
        const msg = (err as Error).message;
        failures.push(`${suite.name} › ${c.name}\n      ${msg}`);
        console.log(`    ✗ ${c.name}`);
      }
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  ${f}`);
  }
  return failed;
}
