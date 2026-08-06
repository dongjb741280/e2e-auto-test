import { exec } from 'child_process';
import { startServer } from '../server/dashboard';

export interface ServeCommandOptions {
  port?: string;
  output?: string;
  open?: boolean;
}

export function serveCommand(options: ServeCommandOptions): void {
  const port = parseInt(options.port || '3456', 10);

  startServer(port, options.output);

  if (options.open) {
    const url = `http://localhost:${port}`;
    const cmd = process.platform === 'darwin' ? `open "${url}"` : process.platform === 'win32' ? `start "${url}"` : `xdg-open "${url}"`;
    exec(cmd);
  }
}
