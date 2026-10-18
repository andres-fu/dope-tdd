# The standard: examples (DRAFT v0.4)

> The third layer of [the standard](2026-10-18_the-standard.md): what good and bad tests look like,
> side by side. Agents follow examples more reliably than rules, so these teach the taste the rules
> cannot check. Original code, written in the style of the sources listed in the standard; names are
> placeholders. Vitest-style TypeScript. **[decide]** Andres approves, edits or replaces each pair.

Each pair names the rule or principle it shows.

## 1. A pure function, with its edges named
Rules 1 and 2: it can fail, and it asserts something real.

```ts
// GOOD: exact values, the zero edge and the failure cases, each named
describe('parseDuration', () => {
  test.each([['1s', 1000], ['1.5m', 90_000], ['0s', 0]])('%s is %i ms', (input, ms) => {
    expect(parseDuration(input)).toBe(ms)
  })
  test('rejects a negative duration', () => expect(() => parseDuration('-1s')).toThrow(/negative/))
  test('rejects an empty string rather than returning 0', () => expect(() => parseDuration('')).toThrow())
})

// BAD: one happy path; the assertion passes for almost any answer
test('parseDuration works', () => {
  expect(parseDuration('1s')).toBeDefined()
})
```
`toBeDefined` cannot fail on a wrong number.

## 2. Behaviour through the public interface
Rule 8: it tests behaviour, not internals.

```ts
// GOOD: only the public API; any correct implementation passes
test('a coupon applied twice discounts once', () => {
  const cart = new Cart()
  cart.add({ sku: 'a', price: 100 })
  cart.applyCoupon('TEN')
  cart.applyCoupon('TEN')
  expect(cart.total()).toBe(90)
})

// BAD: reaches into private state; breaks on a harmless refactor
test('applyCoupon pushes to the coupons array', () => {
  const cart = new Cart()
  cart.applyCoupon('TEN')
  expect((cart as any)._coupons).toEqual(['TEN'])
})
```
The good test states the rule a customer cares about; the bad one asserts a storage choice.

## 3. A mock at the boundary, and a mock of the unit
Rule 3, and the mock principle: mock only at the process boundary.

```ts
// GOOD: mock the mail provider (slow, outside the process); the real logic runs, the date is fixed
test('sends one reminder for an overdue invoice', async () => {
  const mailer = { send: vi.fn().mockResolvedValue(undefined) }
  await remindOverdue([{ id: 1, dueOn: '2026-01-01', email: 'a@x.test' }], mailer, new Date('2026-02-01'))
  expect(mailer.send).toHaveBeenCalledOnce()
  expect(mailer.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'a@x.test' }))
})

// BAD: mocks the unit under test, so it can only pass
test('remindOverdue sends', async () => {
  vi.spyOn(mod, 'remindOverdue').mockResolvedValue(undefined)
  await mod.remindOverdue([], mailer, new Date())
  expect(mod.remindOverdue).toHaveBeenCalled()
})
```
The bad test asserts that its own mock was called.

## 4. A name that reads as a spec
Principle: the name is a line of the spec.

```ts
// GOOD: the rule, the condition and the outcome are in the name
test('a refund larger than the original charge is rejected and leaves the balance unchanged', () => {
  const acct = account(100)
  expect(() => acct.refund(150)).toThrow('exceeds charge')
  expect(acct.balance()).toBe(100)
})

// BAD: says nothing about the rule, and cannot fail
test('refund test 2', () => {
  const acct = account(100)
  try { acct.refund(150) } catch {}
  expect(acct).toBeTruthy()
})
```
Read only the good names and you know the rules.

## 5. A regression test for a real bug
Rule 5: it was not bent to fit the code.

```ts
// GOOD: reproduces the reported input and names the issue
test('keeps the root path as "/" (#312, was stripped to "")', () => {
  expect(normalizePath('/')).toBe('/')
})

// BAD: the expected value was edited to match the wrong output
test('normalizePath handles root', () => {
  expect(normalizePath('/')).toBe('')   // was '/', changed after the "fix"
})
```
An expected value that changes with no change to the spec is the test agreeing with the bug.

## 6. A compliance requirement: personal data never reaches the logs
Rule 2's presence guard, and the compliance section.

```ts
// GOOD: drive the real logger, capture the real output, prove something was logged, then assert absence
test('an email address never appears in log output', () => {
  const lines: string[] = []
  const log = createLogger({ write: line => lines.push(line) })
  signUp({ email: 'jane.doe@example.test', plan: 'pro' }, log)
  expect(lines.length).toBeGreaterThan(0)
  expect(lines.join('\n')).not.toContain('jane.doe@example.test')
})

// BAD: checks the logger was called, never what it was given
test('signUp logs', () => {
  const log = { info: vi.fn() }
  signUp({ email: 'jane.doe@example.test', plan: 'pro' }, log as any)
  expect(log.info).toHaveBeenCalled()
})
```
Without the `length > 0` guard, the good test would also pass if nothing were logged at all.

## 7. Coverage without a test
Rule 2: an assertion-free test.

```ts
// GOOD: the outcome the caller depends on
test('retries a failing fetch three times, then surfaces the last error', async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error('boom'))
  await expect(withRetry(fetcher, { attempts: 3 })).rejects.toThrow('boom')
  expect(fetcher).toHaveBeenCalledTimes(3)
})

// BAD: runs the code for coverage and asserts nothing
test('withRetry', async () => {
  await withRetry(vi.fn().mockResolvedValue(1), { attempts: 3 })
})
```
Delete the retry loop and the bad test still passes.

## Our own tests, measured against this
Reviewed 2026-10-18, so the standard applies to us first:
- `tests/shellVerdict.test.ts` mostly qualifies. To fix: two names describe setup rather than a rule
  ("nothing to say says nothing", "every kind of line, in its fixed order"), and the nine-line
  ordering test should be one test per line plus a short ordering test.
- `tests/runPlan.test.ts` is weaker. To fix: several tests assert many fields of the state at once
  (assertion roulette), setup is built with `recordRedFor` from the stats module rather than plain
  data, and the `facts()` and `workingOn()` helpers hide what each case depends on (mystery guest).
