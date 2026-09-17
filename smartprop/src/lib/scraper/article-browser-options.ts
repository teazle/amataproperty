import { isAbsolute } from 'node:path';

type ChromiumLaunchOptions = {
  channel?: string;
  executablePath?: string;
  chromiumSandbox?: boolean;
  headless?: boolean;
  timeout?: number;
  args?: string[];
};

const sandboxDisabledArgs = new Set(['--no-sandbox', '--disable-setuid-sandbox']);

export function articleBrowserLaunchOptions<T extends ChromiumLaunchOptions>(
  defaults: T,
): Omit<T, 'channel' | 'args'> & ChromiumLaunchOptions {
  const executablePath = process.env.SMARTPROP_ARTICLE_BROWSER_EXECUTABLE;
  if (executablePath === undefined) {
    return defaults;
  }

  if (!isAbsolute(executablePath)) {
    throw new Error('SMARTPROP_ARTICLE_BROWSER_EXECUTABLE must be an absolute path');
  }

  const { channel: _channel, args, ...remaining } = defaults;
  return {
    ...remaining,
    ...(args === undefined ? {} : { args: args.filter((arg) => !sandboxDisabledArgs.has(arg)) }),
    executablePath,
    chromiumSandbox: true,
  } as Omit<T, 'channel' | 'args'> & ChromiumLaunchOptions;
}
