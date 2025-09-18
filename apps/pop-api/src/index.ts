import { startServer } from './server';

startServer().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start POP API', error);
  process.exitCode = 1;
});
