using System;
using System.Collections.Generic;
using ScpslTrust.Core;
using ScpslTrust.Core.Abstractions;
using ScpslTrust.Core.Api;
using ScpslTrust.Core.Players;
using ScpslTrust.Core.Security;
using ScpslTrust.Core.Services;

namespace ScpslTrust.DevClient
{
    /// <summary>Thrown for bad command-line input; message is shown to the user, exit code 1.</summary>
    internal sealed class CliUsageException : Exception
    {
        public CliUsageException(string message)
            : base(message)
        {
        }
    }

    /// <summary>Logs to stderr so stdout stays parseable JSON.</summary>
    internal sealed class StderrLogger : ITrustLogger
    {
        private readonly bool _debug;

        public StderrLogger(bool debug) => _debug = debug;

        public void Debug(string message)
        {
            if (_debug)
            {
                Console.Error.WriteLine("[debug] " + message);
            }
        }

        public void Info(string message) => Console.Error.WriteLine("[info] " + message);

        public void Warn(string message) => Console.Error.WriteLine("[warn] " + message);

        public void Error(string message) => Console.Error.WriteLine("[error] " + message);
    }

    /// <summary>Parsed command line: a command, <c>--key value</c> options and <c>--flag</c> switches.</summary>
    internal sealed class CliArgs
    {
        private static readonly HashSet<string> Flags = new HashSet<string>(StringComparer.Ordinal)
        {
            "--force", "--insecure", "--debug", "--tamper-signature", "--replay",
        };

        private readonly Dictionary<string, string> _options = new Dictionary<string, string>(StringComparer.Ordinal);
        private readonly HashSet<string> _flags = new HashSet<string>(StringComparer.Ordinal);

        public string Command { get; }

        private CliArgs(string command) => Command = command;

        public static CliArgs Parse(string[] args)
        {
            if (args.Length == 0 || args[0].StartsWith("-", StringComparison.Ordinal))
            {
                throw new CliUsageException("No command given. Run 'trust-devclient help'.");
            }

            var result = new CliArgs(args[0].ToLowerInvariant());
            for (var i = 1; i < args.Length; i++)
            {
                var arg = args[i];
                if (!arg.StartsWith("--", StringComparison.Ordinal))
                {
                    throw new CliUsageException("Unexpected argument '" + arg + "' (options start with --).");
                }

                if (Flags.Contains(arg))
                {
                    result._flags.Add(arg);
                    continue;
                }

                if (i + 1 >= args.Length)
                {
                    throw new CliUsageException("Option '" + arg + "' needs a value.");
                }

                result._options[arg] = args[++i];
            }

            return result;
        }

        public bool Has(string flag) => _flags.Contains(flag);

        public string? Optional(string name) => _options.TryGetValue(name, out var value) ? value : null;

        public string Required(string name)
        {
            var value = Optional(name);
            if (string.IsNullOrWhiteSpace(value))
            {
                throw new CliUsageException("Option '" + name + "' is required for '" + Command + "'.");
            }

            return value!;
        }

        public int IntOption(string name, int defaultValue, int min, int max)
        {
            var raw = Optional(name);
            if (raw == null)
            {
                return defaultValue;
            }

            if (!int.TryParse(raw, out var value) || value < min || value > max)
            {
                throw new CliUsageException("Option '" + name + "' must be an integer between " + min + " and " + max + ".");
            }

            return value;
        }

        public PlayerRef Player(string name)
        {
            var raw = Required(name);
            if (!PlayerRef.TryParseUserId(raw, out var player))
            {
                throw new CliUsageException("Option '" + name + "' must be a canonical user id like 76561198000000001@steam.");
            }

            return player;
        }

        public DateTimeOffset? IsoOption(string name)
        {
            var raw = Optional(name);
            if (raw == null)
            {
                return null;
            }

            if (!DateTimeOffset.TryParse(raw, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.RoundtripKind, out var value))
            {
                throw new CliUsageException("Option '" + name + "' must be an ISO 8601 timestamp.");
            }

            return value;
        }
    }

    /// <summary>Shared wiring: identity store, API client and services, built from common options.</summary>
    internal sealed class CliContext : IDisposable
    {
        public CliArgs Args { get; }

        public ITrustLogger Logger { get; }

        public IClock Clock { get; } = SystemClock.Instance;

        public string IdentityDirectory { get; }

        public ServerIdentityHolder Identities { get; }

        private TrustApiClient? _client;

        public CliContext(CliArgs args)
        {
            Args = args;
            Logger = new StderrLogger(args.Has("--debug"));
            IdentityDirectory = args.Optional("--identity")
                ?? Environment.GetEnvironmentVariable("TRUST_IDENTITY_DIR")
                ?? "trust-identity";
            Identities = new ServerIdentityHolder(new KeyStore(IdentityDirectory), Logger);
            Identities.TryLoad();
        }

        /// <summary>Identity that must exist and be registered (all signed commands).</summary>
        public ServerIdentity RequireRegistered()
        {
            if (Identities.LoadError != null)
            {
                throw new CliUsageException(Identities.Store.IdentityPath + " is unreadable: " + Identities.LoadError);
            }

            var identity = Identities.Current;
            if (identity == null)
            {
                throw new CliUsageException("No identity in '" + IdentityDirectory + "'. Run 'register' first (see --identity).");
            }

            if (!identity.IsRegistered)
            {
                throw new CliUsageException("The identity in '" + IdentityDirectory + "' is not registered yet. Run 'register'.");
            }

            return identity;
        }

        /// <summary>API client for --api (or $TRUST_API); https required unless loopback or --insecure.</summary>
        public ITrustApiClient Client()
        {
            if (_client != null)
            {
                return _client;
            }

            var raw = Args.Optional("--api") ?? Environment.GetEnvironmentVariable("TRUST_API");
            if (string.IsNullOrWhiteSpace(raw))
            {
                throw new CliUsageException("Option '--api <url>' (or environment variable TRUST_API) is required for '" + Args.Command + "'.");
            }

            if (!TrustApiClientOptions.TryNormalizeBaseUrl(raw, allowInsecureHttp: Args.Has("--insecure"), out var baseUri, out var error))
            {
                throw new CliUsageException("--api: " + error);
            }

            var options = new TrustApiClientOptions(baseUri!, TrustInfo.PluginVersion)
            {
                RequestTimeout = TimeSpan.FromSeconds(Args.IntOption("--timeout", 10, 1, 300)),
            };
            var tamper = Args.Has("--tamper-signature");
            var replay = Args.Has("--replay");
            _client = tamper || replay
                ? new TrustApiClient(options, Identities, Clock, Logger, new DebugTransport(tamper, replay))
                : new TrustApiClient(options, Identities, Clock, Logger);
            return _client;
        }

        public void Dispose() => _client?.Dispose();
    }
}
