# Postfix++ Interpreter (JavaScript)

A stack-based interpreter for **Postfix++**: postfix (reverse Polish) arithmetic extended with single-letter variables `A` to `Z` and an assignment operator `=`. Built for the midterm of CM2035 Algorithms and Data Structures II (BSc Computer Science, University of London, academic direction by Goldsmiths).

## Example session

```
> A 2 =
[]
> B 3 =
[]
> A B *
[6]
> 10 4 /
[2.5 6]
```

The stack is shown top first. Each line is evaluated left to right: numbers and variables are pushed, operators pop their operands and push the result, and `=` assigns a value to a variable.

## How it works

- **Stack:** a last-in-first-out store backed by an array, with O(1) push and pop. Underflow is reported as "too few operands" instead of crashing.
- **Symbol table:** a direct-address table with one slot per letter `A` to `Z`, giving O(1) insert and lookup.
- **Lazy variable resolution:** variables are pushed as names and only resolved to values when an operator needs them, which is what makes assignment possible.
- **Error recovery:** each line runs on a snapshot of the stack, so an error mid-line (division by zero, unassigned variable, invalid token, malformed assignment) rolls the stack back to its state before that line.
- **Clean output:** floating-point noise such as `0.30000000000000004` is trimmed for display only.

## Running it

Requires [Node.js](https://nodejs.org/).

```bash
node postfixpp.js           # interactive session
node postfixpp.js --test    # built-in test suite (23 tests)
```

## About

Built by Akshit Sankhala as coursework for CM2035 Algorithms and Data Structures II. Shared here as a portfolio piece; please do not submit it as your own coursework.
