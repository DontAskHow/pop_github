import { startServer } from './server';

startServer().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start Semantic Engine', error);
  process.exitCode = 1;
});
