using System;
using System.Threading;
using System.Threading.Tasks;
using ScpslTrust.Core.Api;
using ScpslTrust.Core.Security;

namespace ScpslTrust.DevClient
{
    /// <summary>
    /// End-to-end development client for the trust backend (docs/PLUGIN.md, ARCHITECTURE §18).
    /// stdout is JSON only; logs go to stderr. Exit codes: 0 ok, 1 usage/local error, 2 API error.
    /// </summary>
    internal static class Program
    {
        private const string Usage = @"trust-devclient — SCP:SL Trust Network development client

Usage: trust-devclient <command> [options]

Common options:
  --identity <dir>   identity directory (default: $TRUST_IDENTITY_DIR or ./trust-identity)
  --api <url>        backend base URL, e.g. https://trust.example.org (default: $TRUST_API)
  --timeout <s>      request timeout seconds (default 10)
  --insecure         allow plain http for non-loopback hosts (development only)
  --debug            verbose logging on stderr

Commands:
  init                                       create an unregistered identity file
  register  --token <sreg_…> [--game-version <v>] [--force]
  time                                       backend time + local clock skew
  heartbeat [--players <n>] [--game-version <v>]
  rotate                                     rotate the server key (resolves interrupted rotations)
  check     --player <id@type> [--ip <ip>] [--nickname <n>] [--account-created-at <iso>]
  bypass    --player <id@type> [--ip <ip>] [--types a,b]
  link      --player <id@type> --code <LNK-…>
  report    --player <id@type> --reason <text> [--reporter <id@type>] [--description <text>]
            [--log-excerpt <text> | --log-excerpt-file <path>]
  policy                                     fetch the active server policy
  overwatch --target <id@type> --spectator <id@type> [--seconds <n>]
  help                                       this text";

        private static async Task<int> Main(string[] args)
        {
            using var cancellation = new CancellationTokenSource();
            Console.CancelKeyPress += (_, e) =>
            {
                e.Cancel = true;
                cancellation.Cancel();
            };

            CliArgs parsed;
            try
            {
                parsed = CliArgs.Parse(args);
            }
            catch (CliUsageException ex)
            {
                return Fail(1, "usage_error", ex.Message);
            }

            if (parsed.Command is "help" or "--help" or "-h")
            {
                Console.WriteLine(Usage);
                return 0;
            }

            try
            {
                using var ctx = new CliContext(parsed);
                var result = parsed.Command switch
                {
                    "init" => await Commands.InitAsync(ctx).ConfigureAwait(false),
                    "register" => await Commands.RegisterAsync(ctx, cancellation.Token).ConfigureAwait(false),
                    "time" => await Commands.TimeAsync(ctx, cancellation.Token).ConfigureAwait(false),
                    "heartbeat" => await Commands.HeartbeatAsync(ctx, cancellation.Token).ConfigureAwait(false),
                    "rotate" => await Commands.RotateAsync(ctx, cancellation.Token).ConfigureAwait(false),
                    "check" => await Commands.CheckAsync(ctx, cancellation.Token).ConfigureAwait(false),
                    "bypass" => await Commands.BypassAsync(ctx, cancellation.Token).ConfigureAwait(false),
                    "link" => await Commands.LinkAsync(ctx, cancellation.Token).ConfigureAwait(false),
                    "report" => await Commands.ReportAsync(ctx, cancellation.Token).ConfigureAwait(false),
                    "policy" => await Commands.PolicyAsync(ctx, cancellation.Token).ConfigureAwait(false),
                    "overwatch" => await Commands.OverwatchAsync(ctx, cancellation.Token).ConfigureAwait(false),
                    _ => throw new CliUsageException("Unknown command '" + parsed.Command + "'. Run 'trust-devclient help'."),
                };
                Commands.Print(result);
                return 0;
            }
            catch (OperationCanceledException)
            {
                return Fail(1, "cancelled", "Interrupted.");
            }
            catch (CliUsageException ex)
            {
                return Fail(1, "usage_error", ex.Message);
            }
            catch (TrustApiException ex)
            {
                Console.Error.WriteLine(TrustJson.Serialize(new
                {
                    Error = new
                    {
                        Code = ex.Code,
                        Message = ex.Message,
                        Status = ex.StatusCode,
                        RequestId = ex.RequestId,
                    },
                }, indented: true));
                return 2;
            }
            catch (Exception ex) when (ex is InvalidOperationException or ArgumentException or KeyStoreException or FormatException)
            {
                return Fail(1, "local_error", ex.Message);
            }
        }

        private static int Fail(int exitCode, string code, string message)
        {
            Console.Error.WriteLine(TrustJson.Serialize(new { Error = new { Code = code, Message = message } }, indented: true));
            return exitCode;
        }
    }
}
