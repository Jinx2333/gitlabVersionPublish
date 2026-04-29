/**
 * 串行化 lowdb 写操作，避免并发部署同时写库导致丢更新
 */
let chain = Promise.resolve();

export function enqueueDbWrite(fn) {
  const run = chain.then(() => fn());
  chain = run.catch((e) => {
    console.error('[db]', e);
  });
  return run;
}
