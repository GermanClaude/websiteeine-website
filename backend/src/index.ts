/**
 * Process entry: configuration → container → (optional) migrations → HTTP server →
 * (optional) job scheduler. Graceful shutdown on SIGINT/SIGTERM.
 */
import { buildApp } from './app';
import { ConfigError, loadConfig, type Config } from './config';
import { createContainer, type Deps } from './container';
import { runMigrations } from './db/migrator';
import { resolveMigrationsDir } from './db/paths';
import { registerModuleJobs } from './modules';

function readConfig(): Config {
  try {
    return loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}

async function migrate(deps: Deps): Promise<void> {
  const result = await runMigrations({
    pool: deps.pool,
    migrationsDir: resolveMigrationsDir(),
    logger: { info: (message) => deps.logger.info(message), warn: (message) => deps.logger.warn(message) },
  });
  deps.logger.info({ applied: result.applied.length, already_applied: result.alreadyApplied.length }, 'migrations complete');
}

async function main(): Promise<void> {
  const config = readConfig();
  const deps = createContainer(config);
  const { logger } = deps;
  for (const warning of config.warnings) logger.warn({ config_warning: true }, `CONFIGURATION WARNING: ${warning}`);

  if (config.database.autoMigrate) await migrate(deps);

  const app = await buildApp(deps);
  registerModuleJobs(deps.scheduler, deps);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    const force = setTimeout(() => {
      logger.error('graceful shutdown timed out; exiting');
      process.exit(1);
    }, config.http.shutdownTimeoutMs + 5_000);
    force.unref();
    try {
      await app.close();
      await deps.close();
      logger.info('shutdown complete');
      process.exitCode = 0;
    } catch (err) {
      logger.error({ err }, 'error during shutdown');
      process.exitCode = 1;
    }
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.http.host, port: config.http.port });
  if (config.jobs.enabled) {
    deps.scheduler.start();
    logger.info({ jobs: deps.scheduler.names() }, 'job scheduler started');
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`Fatal startup error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
