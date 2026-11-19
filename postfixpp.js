/*
 * Postfix++ Interpreter
 * ADS2 Mid-term Coursework
 *
 * A stack-based interpreter for "Postfix++": postfix arithmetic with
 * single-letter variables (A-Z) and an assignment operator "=".
 *
 * Run an interactive session:   node postfixpp.js
 * Run the built-in test suite:  node postfixpp.js --test
 *
 * Example session:
 *   > A 2 =
 *   []
 *   > B 3 =
 *   []
 *   > A B *
 *   [6]
 */

'use strict';

/* ------------------------------------------------------------------ *
 * Data structure 1: Stack
 *
 * A last-in-first-out store for the operands/variable-names that are
 * waiting to be consumed by an operator. Backed by a JS array, which
 * gives O(1) push and pop. push/pop/peek are the only operations the
 * evaluation algorithm needs.
 * ------------------------------------------------------------------ */
class Stack {
  constructor() {
    this.items = [];
  }

  push(item) {
    this.items.push(item);
  }

  // Remove and return the top item. Throws on underflow so the
  // interpreter can report "too few operands" rather than crash.
  pop() {
    if (this.isEmpty()) {
      throw new Error('stack underflow (too few operands)');
    }
    return this.items.pop();
  }

  peek() {
    if (this.isEmpty()) {
      throw new Error('stack is empty');
    }
    return this.items[this.items.length - 1];
  }

  isEmpty() {
    return this.items.length === 0;
  }

  size() {
    return this.items.length;
  }

  // Shallow copy of the contents, bottom-first. Used by the interpreter
  // for error rollback and rendering without reaching into internals.
  snapshot() {
    return this.items.slice();
  }

  // Restore contents from a previous snapshot().
  restore(items) {
    this.items = items.slice();
  }
}

/* ------------------------------------------------------------------ *
 * Data structure 2: Symbol table (direct-address table)
 *
 * Maps a variable name (key) to its numeric value. The target hardware
 * has a tiny, FIXED namespace: only the names 'A'-'Z'. That makes a
 * direct-address table the natural choice -- a 26-slot array indexed by
 * (charCode - 'A'). Every operation is O(1) with no hashing, no
 * collisions and minimal memory (ideal for a small device).
 *
 * Alternatives considered (see report): a hash table adds a hash
 * function and collision handling for no benefit on 26 fixed keys; a
 * BST gives O(log n) lookups and pointer overhead; a linked list gives
 * O(n) search. Direct addressing dominates all of them here.
 * ------------------------------------------------------------------ */
class SymbolTable {
  constructor() {
    this.SIZE = 26;
    this.slots = new Array(this.SIZE).fill(undefined); // undefined = unassigned
  }

  // Map 'A'..'Z' to 0..25. Returns -1 for anything else.
  indexOf(name) {
    if (typeof name !== 'string' || name.length !== 1) return -1;
    const i = name.charCodeAt(0) - 'A'.charCodeAt(0);
    return i >= 0 && i < this.SIZE ? i : -1;
  }

  insert(name, value) {
    const i = this.indexOf(name);
    if (i === -1) throw new Error(`invalid variable name "${name}"`);
    this.slots[i] = value;
  }

  // Returns the value, or undefined if the variable was never assigned.
  search(name) {
    const i = this.indexOf(name);
    if (i === -1) throw new Error(`invalid variable name "${name}"`);
    return this.slots[i];
  }

  delete(name) {
    const i = this.indexOf(name);
    if (i === -1) throw new Error(`invalid variable name "${name}"`);
    this.slots[i] = undefined;
  }
}

/* ------------------------------------------------------------------ *
 * Tokens
 *
 * As tokens are read they are pushed onto the stack as small tagged
 * objects, because the stack must hold BOTH values and unresolved
 * variable names. "A 3 =" pushes the NAME A (to be assigned to), while
 * "A B *" needs the VALUES of A and B. Variables are therefore resolved
 * lazily -- only at the moment an operator consumes them.
 * ------------------------------------------------------------------ */
function numToken(value) {
  return { type: 'num', value };
}
function varToken(name) {
  return { type: 'var', name };
}

// Format a number for display, trimming binary floating-point noise
// (e.g. 0.1 + 0.2 -> 0.3 rather than 0.30000000000000004) while leaving
// integers and normal decimals exact. Arithmetic itself is unchanged;
// this only affects what the user sees.
function formatNumber(x) {
  if (!Number.isFinite(x)) return String(x);
  return String(Number(x.toPrecision(12)));
}

const OPERATORS = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => {
    if (b === 0) throw new Error('division by zero');
    return a / b;
  },
};

/* ------------------------------------------------------------------ *
 * The interpreter
 * ------------------------------------------------------------------ */
class Interpreter {
  constructor() {
    this.stack = new Stack();
    this.symbols = new SymbolTable();
  }

  // Split a line into whitespace-separated tokens.
  tokenize(line) {
    return line.trim().split(/\s+/).filter((t) => t.length > 0);
  }

  // Classify a raw token string.
  classify(raw) {
    // hasOwnProperty (not "in") so inherited object keys like "toString"
    // are never mistaken for operators.
    if (Object.prototype.hasOwnProperty.call(OPERATORS, raw)) {
      return { kind: 'op', raw };
    }
    if (raw === '=') return { kind: 'assign' };
    // A number: optional sign, digits, optional decimal part.
    if (/^-?\d+(\.\d+)?$/.test(raw)) return { kind: 'num', value: Number(raw) };
    // A single letter A-Z is a variable.
    if (/^[A-Z]$/.test(raw)) return { kind: 'var', name: raw };
    return { kind: 'invalid', raw };
  }

  // Resolve a stack token to a numeric value. Numbers pass through;
  // variables are looked up (error if never assigned).
  resolve(tok) {
    if (tok.type === 'num') return tok.value;
    const v = this.symbols.search(tok.name);
    if (v === undefined) {
      throw new Error(`variable "${tok.name}" used before assignment`);
    }
    return v;
  }

  // Apply a binary operator: pop two operands (b is top), evaluate.
  applyOperator(raw) {
    const b = this.resolve(this.stack.pop()); // top  = right operand
    const a = this.resolve(this.stack.pop()); // next = left  operand
    const result = OPERATORS[raw](a, b);
    this.stack.push(numToken(result));
  }

  // Apply assignment: pop value (top), then pop a variable NAME (not
  // resolved), and store value into the symbol table.
  applyAssign() {
    // "=" needs two operands: a target variable and a value. Guard first so
    // a malformed line like "A =" gives a clear message rather than a
    // misleading "used before assignment".
    if (this.stack.size() < 2) {
      throw new Error('assignment needs a variable and a value');
    }
    const value = this.resolve(this.stack.pop()); // value may itself be a var
    const target = this.stack.pop();
    if (target.type !== 'var') {
      throw new Error('left side of "=" is not a variable');
    }
    this.symbols.insert(target.name, value);
  }

  // Render the stack the way the brief does: [top ... bottom], with the
  // top as the leftmost token. Variables are resolved to their current
  // value for display; an unassigned variable falls back to its name.
  render() {
    const shown = this.stack.snapshot()
      .reverse()
      .map((tok) => {
        if (tok.type === 'num') return formatNumber(tok.value);
        const v = this.symbols.search(tok.name);
        return v === undefined ? tok.name : formatNumber(v);
      })
      .join(' ');
    return '[' + shown + ']';
  }

  // Evaluate one line of Postfix++. Returns the stack rendering.
  // On error, the offending line is discarded (the stack is left as it
  // was before the line) and the error is reported.
  evaluateLine(line) {
    const tokens = this.tokenize(line);
    if (tokens.length === 0) return this.render();

    // Work on a snapshot so a mid-line error doesn't corrupt the stack.
    const snapshot = this.stack.snapshot();
    try {
      for (const raw of tokens) {
        const t = this.classify(raw);
        switch (t.kind) {
          case 'num':
            this.stack.push(numToken(t.value));
            break;
          case 'var':
            this.stack.push(varToken(t.name));
            break;
          case 'op':
            this.applyOperator(t.raw);
            break;
          case 'assign':
            this.applyAssign();
            break;
          default:
            throw new Error(`invalid token "${t.raw}"`);
        }
      }
    } catch (err) {
      this.stack.restore(snapshot); // roll back
      return `Error: ${err.message}`;
    }
    return this.render();
  }
}

/* ------------------------------------------------------------------ *
 * Interactive REPL
 * ------------------------------------------------------------------ */
function startRepl() {
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
  });

  const interp = new Interpreter();

  console.log('Postfix++ interpreter. Type expressions; Ctrl+C to quit.');
  console.log('Try:  A 2 =   then   B 3 =   then   A B *');
  rl.prompt();

  rl.on('line', (line) => {
    console.log(interp.evaluateLine(line));
    rl.prompt();
  });

  rl.on('close', () => {
    console.log('\nBye.');
    process.exit(0);
  });
}

/* ------------------------------------------------------------------ *
 * Built-in test suite (node postfixpp.js --test)
 * ------------------------------------------------------------------ */
function runTests() {
  let passed = 0;
  let failed = 0;

  // Each test runs a sequence of lines on a fresh interpreter and
  // checks the rendering after the LAST line.
  function check(name, lines, expected) {
    const interp = new Interpreter();
    let out = '';
    for (const l of lines) out = interp.evaluateLine(l);
    const ok = out === expected;
    if (ok) {
      passed++;
      console.log(`  PASS  ${name}`);
    } else {
      failed++;
      console.log(`  FAIL  ${name}: got "${out}", expected "${expected}"`);
    }
  }

  console.log('Running Postfix++ tests:\n');

  // Brief's own examples
  check('3 4 +', ['3 4 +'], '[7]');
  check('3 4 5 + *', ['3 4 5 + *'], '[27]');
  check('assignment leaves empty stack', ['A 3 ='], '[]');
  check('variable multiply session', ['A 2 =', 'B 3 =', 'A B *'], '[6]');

  // Arithmetic
  check('subtraction order', ['10 3 -'], '[7]');
  check('division', ['20 4 /'], '[5]');
  check('decimals', ['1.5 2.5 +'], '[4]');
  check('negative numbers', ['-5 3 +'], '[-2]');
  check('chained operands left on stack', ['1 2 3'], '[3 2 1]');

  // Variables
  check('reassignment', ['A 5 =', 'A 9 =', 'A'], '[9]');
  check('assign one var from another', ['A 4 =', 'B A =', 'B'], '[4]');
  check('var in expression resolves', ['X 10 =', 'X 2 /'], '[5]');

  // Error handling (stack rolls back, error reported)
  check('division by zero', ['5 0 /'], 'Error: division by zero');
  check('stack underflow', ['3 +'], 'Error: stack underflow (too few operands)');
  check('unassigned variable', ['Q 1 +'],
    'Error: variable "Q" used before assignment');
  check('invalid token', ['3 4 $'], 'Error: invalid token "$"');
  check('inherited key is not an operator', ['3 4 toString'],
    'Error: invalid token "toString"');
  check('malformed assignment', ['A ='],
    'Error: assignment needs a variable and a value');
  check('assign to a number', ['3 4 ='],
    'Error: left side of "=" is not a variable');
  check('rollback keeps prior stack', ['5', '0 /', ''], '[5]');

  // Display: floating-point noise is trimmed
  check('float noise trimmed', ['0.1 0.2 +'], '[0.3]');

  // Edge cases
  check('empty line', [''], '[]');
  check('whitespace handling', ['  3    4   +  '], '[7]');

  console.log(`\n${passed} passed, ${failed} failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */
if (require.main === module) {
  if (process.argv.includes('--test')) {
    runTests();
  } else {
    startRepl();
  }
}

module.exports = { Stack, SymbolTable, Interpreter };
