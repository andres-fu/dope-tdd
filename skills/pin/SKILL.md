---
description: Pin the current behaviour of code with tests, prove the tests can fail, then change or refactor the code safely under Dope TDD. Use when asked to refactor, clean up, or change code that has no tests, when refactoring code whose existing test passes (pin what it does now in that test), or when a test went green without ever failing.
argument-hint: "[source file]"
---

# Pin, prove, then change

Use this when the code you are about to change has no test that guards it. The goal is a test that describes what the code does **today**, proven able to fail, before you change anything. Dope TDD watches every step and records the proof.

## 1. Pin what it does today

- Read the source file and its comments. List the behaviours a caller depends on: return values, edge cases (zero, empty, negative, boundaries), rounding, errors thrown.
- Write the test file where this project's layout puts it (the briefing names the layout; `/tdd` shows it too). Touching the test unlocks the module.
- Assert what the code does now, not what you think it should do. If the current behaviour looks wrong, pin it anyway and say so in your reply; fixing it is a separate, later step.
- Keep each test small and named after the behaviour it pins.
- Check what the test reaches: list the module's exports and note which ones the test calls. An export only another test file reaches (or none) is not pinned by this test; pin it here, or say in your reply that it is left out and why.

## 2. Run the pins

Run only that test file, with the command the briefing gives. It should pass. Dope TDD will say **UNPROVEN · never failed**: correct, because a test that has never failed has proven nothing yet.

If a pin is red on its first run, the source has not changed, so the pin guessed today's behaviour wrongly. Fix the assertion to what the code does, and say in your reply which pin was wrong and why. Dope TDD records it as **UNPROVEN · the test changed** after red: that is expected here, and it stays on the record because the same steps would also hide a test rewritten to match a bug. Then prove the corrected pin in step 3 as usual.

## 3. Prove the pins can fail

- Make one deliberate, temporary breakage in the source that the pins should notice (remove a rounding call, flip a comparison, change a constant). Keep it compiling.
- Run the test file. It must go **RED**, and the failures should be the pins you expected. If nothing goes red, your pins do not cover that behaviour: add the missing assertion and break again.
- Restore the source to **exactly** its original text and run again. Dope TDD reports **PROVEN**: the code is back as it was, and the red was the proof.
- One break proves one behaviour. In a git checkout with a Node runner (Vitest, Jest, ava, node --test), Dope TDD then also makes a few small changes to the file in a throwaway copy and runs your test against each. Any it names as "went unnoticed" is behaviour your pins do not check yet: pin the ones that matter, or say why a change cannot alter what the code does. Other runners (pytest, unittest, Java, .NET, Godot) have no throwaway copy yet, so there the one break is the whole check: break each behaviour you pinned on purpose, one at a time.

## 4. Now change the code

- With the pins proven, refactor or change the code. Do not edit the test file during a refactor. If the change is a refactor, the pins stay green and Dope TDD names it **refactor · not re-checked**.
- If you are changing behaviour on purpose, change the test first to the new expectation, see it fail, then change the code: that is an ordinary red, green cycle, and the catch check will verify it (**PROVEN** or **MISSED**).

## What not to do

- Do not skip, comment out, or loosen a pin to get green. Dope TDD records it as a workaround and asks you why.
- Do not re-save the test unchanged to unlock the module. That is recorded too.
- Do not change behaviour and refactor in the same step. One cycle, one kind of change.

When you finish, `/tdd receipt` prints the receipt and the commands a reviewer runs to re-check the proof.
