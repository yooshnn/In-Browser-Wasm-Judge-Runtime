import { createJudgeRuntime } from '../src/index.ts';

const DEFAULT_LIMITS = {
  timeLimitMs: 5000,
  memoryLimitBytes: 256 * 1024 * 1024,
  stdoutLimitBytes: 1024 * 1024,
};

const presets = [
  {
    id: 'accepted',
    title: 'Accepted',
    description: 'Compile, execute, exact checker AC.',
    source: [
      '#include <cstdio>',
      'int main() {',
      '  int a = 0, b = 0;',
      '  if (scanf("%d %d", &a, &b) == 2) printf("%d\\n", a + b);',
      '  return 0;',
      '}',
    ].join('\n'),
    tests: [{ id: 'sample-1', stdin: '2 3\n', expected: '5\n' }],
    checker: 'exact',
    limits: DEFAULT_LIMITS,
  },
  {
    id: 'wrong-answer',
    title: 'Wrong Answer',
    description: 'Successful execution, checker rejects stdout.',
    source: [
      '#include <cstdio>',
      'int main() {',
      '  puts("4");',
      '  return 0;',
      '}',
    ].join('\n'),
    tests: [{ id: 'sample-1', stdin: '', expected: '5\n' }],
    checker: 'exact',
    limits: DEFAULT_LIMITS,
  },
  {
    id: 'compile-error',
    title: 'Compile Error',
    description: 'Invalid C++ returns phase: compile.',
    source: 'this is not valid c++ code',
    tests: [{ id: 'sample-1', stdin: '', expected: '' }],
    checker: 'exact',
    limits: DEFAULT_LIMITS,
  },
  {
    id: 'runtime-error',
    title: 'Runtime Error',
    description: 'Non-zero exit maps to runtime_error.',
    source: 'int main() { return 42; }',
    tests: [{ id: 'sample-1', stdin: '', expected: '' }],
    checker: 'exact',
    limits: DEFAULT_LIMITS,
  },
  {
    id: 'time-limit',
    title: 'Time Limit',
    description: 'Execution worker is terminated on timeout.',
    source: ['int main() {', '  while (true) {}', '}'].join('\n'),
    tests: [{ id: 'sample-1', stdin: '', expected: '' }],
    checker: 'exact',
    limits: {
      ...DEFAULT_LIMITS,
      timeLimitMs: 80,
    },
  },
  {
    id: 'output-limit',
    title: 'Output Limit',
    description: 'fd_write byte accounting triggers OLE.',
    source: [
      '#include <cstdio>',
      'int main() {',
      "  for (int i = 0; i < 512; i++) putchar('a');",
      '  return 0;',
      '}',
    ].join('\n'),
    tests: [{ id: 'sample-1', stdin: '', expected: '' }],
    checker: 'exact',
    limits: {
      ...DEFAULT_LIMITS,
      stdoutLimitBytes: 128,
    },
  },
  {
    id: 'custom-checker',
    title: 'Custom Checker',
    description: 'checkerId resolves to a JS checker in bootstrap options.',
    source: [
      '#include <cstdio>',
      'int main() {',
      '  puts("prefix ok suffix");',
      '  return 0;',
      '}',
    ].join('\n'),
    tests: [
      { id: 'sample-1', stdin: '', expected: 'ignored by custom checker\n' },
    ],
    checker: 'contains-ok',
    limits: DEFAULT_LIMITS,
  },
];

const els = {
  bootstrapButton: document.querySelector('#bootstrap-button'),
  healthButton: document.querySelector('#health-button'),
  judgeButton: document.querySelector('#judge-button'),
  terminateButton: document.querySelector('#terminate-button'),
  clearLogButton: document.querySelector('#clear-log-button'),
  presets: document.querySelector('#presets'),
  runtimeDot: document.querySelector('#runtime-dot'),
  runtimeState: document.querySelector('#runtime-state'),
  runtimeDetail: document.querySelector('#runtime-detail'),
  source: document.querySelector('#source-input'),
  tests: document.querySelector('#tests-input'),
  checker: document.querySelector('#checker-select'),
  timeLimit: document.querySelector('#time-limit-input'),
  memoryLimit: document.querySelector('#memory-limit-input'),
  stdoutLimit: document.querySelector('#stdout-limit-input'),
  summaryCards: document.querySelector('#summary-cards'),
  result: document.querySelector('#result-output'),
  logList: document.querySelector('#log-list'),
};

let runtime = null;
let selectedPresetId = presets[0].id;
let busy = false;

function setBusy(nextBusy) {
  busy = nextBusy;
  els.bootstrapButton.disabled = busy;
  els.healthButton.disabled = busy || !runtime;
  els.judgeButton.disabled = busy || !runtime;
  els.terminateButton.disabled = busy || !runtime;
}

function setRuntimeState(kind, state, detail) {
  els.runtimeDot.className = `dot dot-${kind}`;
  els.runtimeState.textContent = state;
  els.runtimeDetail.textContent = detail;
}

function log(kind, message, data) {
  const item = document.createElement('li');
  item.className = 'log-entry';

  const time = document.createElement('span');
  time.className = 'log-time';
  time.textContent = new Date().toLocaleTimeString();

  const label = document.createElement('span');
  label.className = 'log-kind';
  label.textContent = kind;

  const body = document.createElement('span');
  body.className = 'log-message';
  body.textContent =
    data === undefined ? message : `${message} ${JSON.stringify(data)}`;

  item.append(time, label, body);
  els.logList.prepend(item);
}

function pretty(value) {
  return JSON.stringify(redactLargeBinaryFields(value), null, 2);
}

function redactLargeBinaryFields(value) {
  if (value instanceof Uint8Array) {
    return `<Uint8Array ${value.byteLength} bytes>`;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactLargeBinaryFields(item));
  }

  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, nested] of Object.entries(value)) {
      result[key] = redactLargeBinaryFields(nested);
    }
    return result;
  }

  return value;
}

function readLimits() {
  return {
    timeLimitMs: Number(els.timeLimit.value),
    memoryLimitBytes: Number(els.memoryLimit.value),
  };
}

function readPolicy() {
  return {
    stopOnFirstFailure: false,
    stdoutLimitBytes: Number(els.stdoutLimit.value),
    stderrLimitBytes: 1024 * 1024,
  };
}

function readTests() {
  const parsed = JSON.parse(els.tests.value);
  if (!Array.isArray(parsed)) {
    throw new Error('testcases json must be an array');
  }

  return parsed.map((test, index) => {
    if (!test || typeof test !== 'object') {
      throw new Error(`testcase at index ${index} must be an object`);
    }

    return {
      id: String(test.id ?? `sample-${index + 1}`),
      stdin: String(test.stdin ?? ''),
      expected: String(test.expected ?? ''),
    };
  });
}

function buildRequest() {
  const checker =
    els.checker.value === 'contains-ok'
      ? { kind: 'custom', checkerId: 'contains-ok' }
      : { kind: 'exact', ignoreTrailingWhitespace: true };

  return {
    language: 'cpp',
    submission: {
      sourceCode: els.source.value,
    },
    compile: {
      flags: [],
    },
    policy: readPolicy(),
    problem: {
      id: 'sample-problem',
      limits: readLimits(),
      checker,
      tests: readTests(),
    },
  };
}

function renderSummary(result) {
  const cards = [];
  if (result.phase === 'compile') {
    cards.push(['phase', 'compile']);
    cards.push(['ok', 'false']);
    cards.push(['errors', String(result.compile.errors.length)]);
    cards.push(['elapsed', `${result.compile.elapsedMs} ms`]);
  } else {
    cards.push(['phase', 'finished']);
    cards.push(['status', result.summary.status]);
    cards.push(['ok', String(result.ok)]);
    cards.push(['elapsed', `${result.summary.totalElapsedMs} ms`]);
    cards.push(['passed', `${result.summary.passed}/${result.summary.total}`]);
    cards.push([
      'max memory',
      result.summary.memoryBytes
        ? `${result.summary.memoryBytes} bytes`
        : 'n/a',
    ]);
  }

  els.summaryCards.replaceChildren(
    ...cards.map(([label, value]) => {
      const card = document.createElement('div');
      card.className = 'summary-card';
      card.innerHTML = `<small>${label}</small><strong>${value}</strong>`;
      return card;
    }),
  );
}

function applyPreset(preset) {
  selectedPresetId = preset.id;
  els.source.value = preset.source;
  els.tests.value = JSON.stringify(preset.tests, null, 2);
  els.checker.value = preset.checker;
  els.timeLimit.value = String(preset.limits.timeLimitMs);
  els.memoryLimit.value = String(preset.limits.memoryLimitBytes);
  els.stdoutLimit.value = String(preset.limits.stdoutLimitBytes);
  renderPresetButtons();
  log('preset', preset.title);
}

function renderPresetButtons() {
  els.presets.replaceChildren(
    ...presets.map((preset) => {
      const button = document.createElement('button');
      button.className =
        preset.id === selectedPresetId ? 'preset active' : 'preset';
      button.type = 'button';
      button.innerHTML = `<strong>${preset.title}</strong><small>${preset.description}</small>`;
      button.addEventListener('click', () => applyPreset(preset));
      return button;
    }),
  );
}

async function bootstrapRuntime() {
  setBusy(true);
  setRuntimeState(
    'idle',
    'Bootstrapping...',
    'Fetching sysroot and loading compiler worker.',
  );
  log('bootstrap', 'start');

  try {
    runtime = await createJudgeRuntime({
      artifactBaseUrl: '/',
      version: 'sample-dev',
      checkers: {
        'contains-ok': async ({ execution }) =>
          execution.stdout.includes('ok')
            ? { status: 'accepted', message: 'stdout contains "ok"' }
            : {
                status: 'wrong_answer',
                message: 'stdout does not contain "ok"',
              },
      },
    });

    const health = await runtime.health();
    setRuntimeState('ready', 'Ready', `version=${health.version}`);
    renderSummary({
      phase: 'finished',
      ok: true,
      summary: { status: 'accepted', passed: 0, total: 0, totalElapsedMs: 0 },
    });
    log('health', 'ready', health);
  } catch (error) {
    runtime = null;
    setRuntimeState(
      'error',
      'Bootstrap failed',
      error instanceof Error ? error.message : String(error),
    );
    log('error', 'bootstrap failed', String(error));
  } finally {
    setBusy(false);
  }
}

async function runHealth() {
  if (!runtime) return;
  setBusy(true);
  try {
    const health = await runtime.health();
    els.result.textContent = pretty(health);
    log('health', 'ok', health);
  } catch (error) {
    log('error', 'health failed', String(error));
  } finally {
    setBusy(false);
  }
}

async function runJudge() {
  if (!runtime) return;
  let request;
  try {
    request = buildRequest();
  } catch (error) {
    log(
      'error',
      'invalid request',
      error instanceof Error ? error.message : String(error),
    );
    return;
  }
  els.result.textContent = pretty(request);
  setBusy(true);
  log('judge', 'start', {
    checker: request.problem.checker,
    limits: request.problem.limits,
    policy: request.policy,
  });

  try {
    const started = performance.now();
    const result = await runtime.judge(request);
    const wallMs = Math.round(performance.now() - started);
    renderSummary(result);
    els.result.textContent = pretty(result);
    log('judge', 'finished', {
      wallMs,
      phase: result.phase,
      status:
        result.phase === 'finished' ? result.summary.status : 'compile_error',
    });
  } catch (error) {
    log('error', 'judge failed', String(error));
  } finally {
    setBusy(false);
  }
}

function terminateRuntime() {
  if (!runtime) return;
  runtime.terminate();
  runtime = null;
  setRuntimeState(
    'idle',
    'Terminated',
    'Bootstrap again to create a new runtime.',
  );
  setBusy(false);
  log('runtime', 'terminated');
}

function init() {
  renderPresetButtons();
  applyPreset(presets[0]);
  renderSummary({ phase: 'compile', compile: { errors: [], elapsedMs: 0 } });
  setRuntimeState('idle', 'Not bootstrapped', 'Click Bootstrap Runtime first.');
  setBusy(false);

  els.bootstrapButton.addEventListener('click', bootstrapRuntime);
  els.healthButton.addEventListener('click', runHealth);
  els.judgeButton.addEventListener('click', runJudge);
  els.terminateButton.addEventListener('click', terminateRuntime);
  els.clearLogButton.addEventListener('click', () =>
    els.logList.replaceChildren(),
  );
}

init();
