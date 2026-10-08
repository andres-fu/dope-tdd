# Bug reports

Three bugs are planted in `src/`. None of them has a test. They are written the
way a teammate or a QA engineer would report them, without the fix.

## Bug 1 · Negative amounts print wrong

`formatCents` in `src/money/formatCents.ts`.

- Steps: format a refund of -1250 cents.
- Expected: `-$12.50`
- Actual: `$-12.50`
- Also: `formatCents(-50)` shows `$0.50`, which loses the minus sign entirely.

## Bug 2 · Slugs have repeated and trailing dashes

`slugify` in `src/text/slugify.ts`.

- Steps: slugify the title `Hello,  World!`
- Expected: `hello-world`
- Actual: `hello---world-`
- Any run of punctuation or spaces becomes several dashes, and a title that
  ends in punctuation ends in a dash.

## Bug 3 · Discounts are a cent off

`applyDiscount` in `src/cart/applyDiscount.ts`.

- Steps: apply 15% off to 1999 cents.
- Expected: 1699 (1999 minus 299.85, rounded to the nearest cent)
- Actual: 1699 here, but apply 15% off to 1001: expected 851, actual 850.
- The result is always rounded down, so half the time the customer is
  overcharged by a cent.

## Not a bug · `wrapLines` is ugly but correct

`wrapLines` in `src/text/wrapLines.ts` works. It is just hard to read. It is
here for the refactoring walk in the README.
