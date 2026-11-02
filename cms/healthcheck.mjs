const target = new URL('/server/health', process.argv[2] ?? 'http://127.0.0.1:8055');
const timeout = AbortSignal.timeout(5_000);

try {
  const response = await fetch(target, {
    headers: { accept: 'application/json' },
    signal: timeout,
  });
  if (!response.ok) {
    console.error(`Directus healthcheck: HTTP ${response.status}`);
    process.exitCode = 1;
  } else {
    const body = await response.json();
    if (body.status !== 'ok') {
      console.error('Directus healthcheck: служба ответила, но не сообщила status=ok.');
      process.exitCode = 1;
    } else {
      console.log('Directus healthcheck: ok.');
    }
  }
} catch (error) {
  console.error(`Directus healthcheck: ${error instanceof Error ? error.message : 'неизвестная ошибка'}`);
  process.exitCode = 1;
}

