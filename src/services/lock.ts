let tail: Promise<void> = Promise.resolve();

// Serializa a execução de operações críticas (check-then-create) dentro do processo.
// Nota: protege apenas servidores de instância única. Para múltiplas instâncias
// seria necessário um mecanismo distribído (ex.: banco de dados).
export async function withCriticalSection<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  tail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}