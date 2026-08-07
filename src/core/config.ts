import fs from 'fs';
import path from 'path';
import type { ProjectConfig } from '../types';

/**
 * Minimal YAML parser for e2e.config.yaml — handles the known config structure
 * (nested objects, string/number/boolean values, comments, quoted strings).
 * Does NOT support: arrays, multi-line strings, anchors, references, flow style.
 */
function parseSimpleYaml(content: string): Record<string, any> {
  const lines = content.split('\n');
  const root: Record<string, any> = {};
  const stack: { indent: number; obj: Record<string, any> }[] = [{ indent: -1, obj: root }];

  for (const rawLine of lines) {
    // Strip comments (but not inside quoted strings)
    const commentIdx = rawLine.indexOf('#');
    const line = commentIdx >= 0 ? rawLine.substring(0, commentIdx) : rawLine;
    if (line.trim() === '') continue;

    const indent = line.search(/\S/);
    const trimmed = line.trim();
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx < 0) continue;

    const key = trimmed.substring(0, colonIdx).trim();
    let value = trimmed.substring(colonIdx + 1).trim();

    // Pop stack to find parent at this indentation level
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].obj;

    if (value === '') {
      // Nested object — value is the next lines at deeper indentation
      const obj: Record<string, any> = {};
      parent[key] = obj;
      stack.push({ indent, obj });
    } else {
      // Scalar value
      parent[key] = parseYamlValue(value);
    }
  }

  return root;
}

function parseYamlValue(value: string): any {
  // Remove surrounding quotes
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  // Booleans
  if (value === 'true') return true;
  if (value === 'false') return false;
  // Numbers
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

const CONFIG_NAMES = ['e2e.config.yaml', 'e2e.config.yml', 'e2e.config.json'];

/**
 * Load project configuration from the project root.
 * Searches for e2e.config.yaml, e2e.config.yml, or e2e.config.json.
 * Returns null if no config file is found.
 */
export function loadProjectConfig(projectPath: string): ProjectConfig | null {
  for (const name of CONFIG_NAMES) {
    const configPath = path.join(projectPath, name);
    if (!fs.existsSync(configPath)) continue;

    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = name.endsWith('.json')
        ? JSON.parse(raw)
        : parseSimpleYaml(raw);
      return parsed as ProjectConfig;
    } catch (e) {
      console.warn(`Warning: failed to parse ${configPath}: ${(e as Error).message}`);
    }
  }

  return null;
}

/**
 * Merge project config with CLI-provided options.
 * CLI options take precedence over config file values.
 */
export function resolveConfig(
  projectPath: string,
  cliOptions: { baseUrl?: string; pages?: string[]; headed?: boolean },
): {
  baseUrl?: string;
  login?: ProjectConfig['login'];
  pages?: string[];
  headed?: boolean;
  viewport?: { width: number; height: number };
} {
  const config = loadProjectConfig(projectPath);

  return {
    baseUrl: cliOptions.baseUrl || config?.baseUrl,
    login: config?.login,
    pages: cliOptions.pages || (config?.login ? [config.login.url] : undefined),
    headed: cliOptions.headed ?? (config?.browsers?.headless === false ? true : undefined),
    viewport: config?.browsers?.viewport,
  };
}
