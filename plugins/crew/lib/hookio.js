// hookio.js — read a hook's JSON payload from stdin, and a one-line emitter.
// Hooks must always exit 0 and never throw uncaught — coordination is best-effort
// and must never break the user's actual workflow.

export function readInput() {
  return new Promise((resolve) => {
    let data = '';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
    setTimeout(finish, 4000).unref(); // safety net if stdin never closes
  });
}

export function emit(obj) {
  try {
    if (obj && Object.keys(obj).length) process.stdout.write(JSON.stringify(obj));
  } catch {
    /* ignore */
  }
  process.exit(0);
}
