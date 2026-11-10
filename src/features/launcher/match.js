// Text matching and scoring for the launcher, plus a small calculator.
//
// Lowercases and strips diacritics, so "cafe" matches "Café".
export function fold(text) {
    return (text ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

// Folds per character so indexes still line up with the original text.
const ASCII = /^[\x00-\x7f]*$/;
const foldAligned = text => ASCII.test(text)
    ? text.toLowerCase()
    : text.split('').map(c => fold(c)[0] ?? c).join('');

// Characters that separate words; lower->upper transitions (camelCase) do too.
const SEPARATOR = /[\s\-_./()—–·:]/;
const LOWER = /\p{Ll}/u;
const UPPER = /\p{Lu}/u;

// Everything matching needs to know about a text, worked out once: the same app
// names and file names are scored again on every keystroke.
const PREPARED_MAX = 5000;
const prepared = new Map();

// Cached per text. `bounds[i]` is 1 where a word starts.
function prepare(text) {
    let p = prepared.get(text);
    if (p)
        return p;
    // bounds[i]: a word starts at i
    const bounds = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
        bounds[i] = i === 0 || SEPARATOR.test(text[i - 1]) ||
            (LOWER.test(text[i - 1]) && UPPER.test(text[i])) ? 1 : 0;
    }
    p = {text: foldAligned(text), bounds};
    if (prepared.size >= PREPARED_MAX)
        prepared.clear();
    prepared.set(text, p);
    return p;
}

// Each query letter must either follow the previous match or start a word,
// so "vsc" finds "Visual Studio Code" but "fire" doesn't find "jh-fixes — LibreWolf".
// Scores a fuzzy match of `query` as a subsequence of `text`. Consecutive matches get
// a growing bonus; gaps cost points. Returns null if the letters do not all occur.
function subsequence(query, text, bounds) {
    let score = 0;
    let at = 0;
    let streak = 0;
    for (const ch of query) {
        let found = -1;
        if (at > 0 && text[at] === ch) {
            found = at;
        } else {
            for (let i = text.indexOf(ch, at); i >= 0; i = text.indexOf(ch, i + 1)) {
                if (bounds[i]) {
                    found = i;
                    break;
                }
            }
        }
        if (found < 0)
            return null;
        if (found === at && at > 0) {
            streak++;
            score += 6 * streak;
        } else {
            streak = 0;
            score += 10 - Math.min(found - at, 10);
        }
        at = found + 1;
    }
    return score;
}

// Score of one text for a query, or null for no match. Tiers: exact (1000), prefix
// (~900), substring (~800 at a word start, ~600 elsewhere), fuzzy (300+). Fuzzy
// matching needs at least two letters.
export function scoreText(query, text) {
    if (!query || !text)
        return null;
    const {text: t, bounds} = prepare(text);
    if (t === query)
        return 1000;
    const idx = t.indexOf(query);
    if (idx === 0)
        return 900 - Math.min(t.length - query.length, 50);
    if (idx > 0)
        return (bounds[idx] ? 800 : 600) - Math.min(idx, 50);
    if (query.length < 2)
        return null;
    const sub = subsequence(query, t, bounds);
    return sub === null ? null : 300 + sub;
}

// The query is split into words once and reused for all candidates.
let splitQuery = null;
let splitWords = null;

function wordsOf(query) {
    if (query !== splitQuery) {
        splitQuery = query;
        splitWords = query.split(/\s+/).filter(Boolean);
    }
    return splitWords;
}

// fields: [[text, weight], ...]. Every word of the query must match some field.
// Best weighted score over all fields. A multi-word query may also match when each
// word matches some field (e.g. "code visual"), at a small penalty.
export function scoreFields(query, fields) {
    const whole = best(query, fields);
    const words = wordsOf(query);
    if (words.length < 2)
        return whole;
    let sum = 0;
    for (const word of words) {
        const s = best(word, fields);
        if (s === null)
            return whole;
        sum += s;
    }
    const split = sum / words.length - 50;
    return whole === null ? split : Math.max(whole, split);
}

// Highest weighted score among the fields.
function best(query, fields) {
    let top = null;
    for (const [text, weight] of fields) {
        const s = scoreText(query, text);
        if (s !== null && (top === null || s * weight > top))
            top = s * weight;
    }
    return top;
}

// Small calculator: + - * / % ^, parentheses, constants and a few functions.
// Functions and constants available to the calculator.
const FUNCTIONS = {
    sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, round: Math.round,
    floor: Math.floor, ceil: Math.ceil, ln: Math.log, log: Math.log10, log2: Math.log2,
    sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
    exp: Math.exp,
};
const CONSTANTS = {pi: Math.PI, e: Math.E, tau: 2 * Math.PI};

// Splits an expression into numbers, names and operators. Accepts a decimal comma
// and the symbols × ÷ **. Returns null on anything else.
function tokenize(src) {
    const tokens = [];
    const re = /\s*(?:(\d+(?:[.,]\d+)?(?:e[+-]?\d+)?|[.,]\d+)|([a-z]+\d?)|(\*\*|[-+*/%^()×÷!]))/gy;
    let m;
    let at = 0;
    while (at < src.length) {
        re.lastIndex = at;
        m = re.exec(src);
        if (!m)
            return /^\s*$/.test(src.slice(at)) ? tokens : null;
        at = re.lastIndex;
        if (m[1] !== undefined)
            tokens.push({num: parseFloat(m[1].replace(',', '.'))});
        else if (m[2] !== undefined)
            tokens.push({name: m[2]});
        else
            tokens.push({op: {'**': '^', '×': '*', '÷': '/'}[m[3]] ?? m[3]});
    }
    return tokens;
}

// Evaluates a calculator expression and returns the formatted result, or null if the
// text is not a calculation. Recursive descent, lowest to highest precedence:
// expr (+ -), term (* / %, implicit multiplication), unary (sign), power (^),
// postfix (!), primary (number, constant, function, parentheses).
// A bare number does not count: there must be an operator or function, so typing
// "42" does not show a result.
export function calculate(src) {
    const text = src.toLowerCase().trim().replace(/^=/, '');
    if (!/[\d)]/.test(text) && !/\b(pi|tau|e)\b/.test(text))
        return null;
    const tokens = tokenize(text);
    if (!tokens?.length)
        return null;
    let pos = 0;
    let usedOperator = false;
    const peek = () => tokens[pos];
    const take = op => {
        if (peek()?.op === op) {
            pos++;
            return true;
        }
        return false;
    };

    function primary() {
        const t = tokens[pos++];
        if (!t)
            throw new Error('end');
        if (t.num !== undefined)
            return t.num;
        if (t.name !== undefined) {
            if (t.name in CONSTANTS)
                return CONSTANTS[t.name];
            if (t.name in FUNCTIONS) {
                usedOperator = true;
                return FUNCTIONS[t.name](unary());
            }
            throw new Error('name');
        }
        if (t.op === '(') {
            const v = expr();
            if (!take(')') && pos < tokens.length)
                throw new Error('paren');
            return v;
        }
        throw new Error('token');
    }
    function postfix() {
        let v = primary();
        while (take('!')) {
            usedOperator = true;
            if (v < 0 || v > 170 || !Number.isInteger(v))
                throw new Error('factorial');
            let r = 1;
            for (let i = 2; i <= v; i++)
                r *= i;
            v = r;
        }
        return v;
    }
    function power() {
        const base = postfix();
        if (take('^')) {
            usedOperator = true;
            return base ** unary();
        }
        return base;
    }
    function unary() {
        if (take('-'))
            return -unary();
        if (take('+'))
            return unary();
        return power();
    }
    function term() {
        let v = unary();
        for (;;) {
            if (take('*'))
                v *= unary();
            else if (take('/'))
                v /= unary();
            else if (take('%'))
                v %= unary();
            else if (peek()?.op === '(' || peek()?.name !== undefined)
                v *= unary();
            else
                return v;
            usedOperator = true;
        }
    }
    function expr() {
        let v = term();
        for (;;) {
            if (take('+'))
                v += term();
            else if (take('-'))
                v -= term();
            else
                return v;
            usedOperator = true;
        }
    }

    try {
        const value = expr();
        if (pos !== tokens.length || !usedOperator || !Number.isFinite(value))
            return null;
        return formatNumber(value);
    } catch {
        return null;
    }
}

// Integers as they are, other values rounded to 12 significant digits to hide
// floating point noise (0.1 + 0.2 -> 0.3).
function formatNumber(value) {
    if (Number.isInteger(value) && Math.abs(value) < 1e21)
        return `${value}`;
    const fixed = parseFloat(value.toPrecision(12));
    return `${fixed}`;
}
