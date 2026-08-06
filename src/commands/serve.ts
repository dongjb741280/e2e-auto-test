import { exec } from 'child_process';
import { startServer } from '../server/dashboard';

export interface ServeCommandOptions {
  port?: string;
  output?: string;
  open?: boolean;
}

export function serveCommand(options: ServeCommandOptions): void {
  const port = parseInt(options.port || '3456', 10);

  const server = startServer(port, options.output);

  // Graceful shutdown on Ctrl+C
  const shutdown = () => {
    console.log('\n  Shutting down...');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Handle port-in-use
  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  Port ${port} is already in use.`);
      console.error(`  Try: kill $(lsof -t -i:${port}) or use --port <n>\n`);
      process.exit(1);
    }
    throw err;
  });

  if (options.open) {
    const url = `http://localhost:${port}`;
    const cmd = process.platform === 'darwin' ? `open "${url}"` : process.platform === 'win32' ? `start "${url}"` : `xdg-open "${url}"`;
    exec(cmd);
  }

  console.log('  Press Ctrl+C to stop');
}
