using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using ScpslTrust.Core;
using ScpslTrust.Core.Api;
using ScpslTrust.Core.Api.Models;
using ScpslTrust.Core.Proof;
using ScpslTrust.Core.Security;
using ScpslTrust.Core.Services;

namespace ScpslTrust.DevClient
{
    /// <summary>One method per CLI command; each prints a JSON document to stdout.</summary>
    internal static class Commands
    {
        public static Task<object> InitAsync(CliContext ctx)
        {
            var store = ctx.Identities.Store;
            if (ctx.Identities.LoadError != null)
            {
                throw new CliUsageException(store.IdentityPath + " is unreadable: " + ctx.Identities.LoadError);
            }

            // identity.json only ever holds registered identities; a fresh key waits in
            // identity.pending.json until 'register' succeeds (same flow as the plugin).
            var existing = ctx.Identities.Current ?? store.LoadPending();
            var created = false;
            if (existing == null)
            {
                existing = new ServerIdentity(null, Ed25519KeyPair.Generate(), ctx.Clock.UtcNow);
                store.SavePending(existing);
                created = true;
            }

            return Task.FromResult<object>(new
            {
                IdentityPath = existing.IsRegistered ? store.IdentityPath : store.PendingPath,
                Created = created,
                Registered = existing.IsRegistered,
                ServerId = existing.ServerId,
                Fingerprint = existing.Fingerprint,
                PublicKey = Convert.ToBase64String(existing.KeyPair.GetPublicKey()),
            });
        }

        public static async Task<object> RegisterAsync(CliContext ctx, CancellationToken ct)
        {
            var service = new RegistrationService(ctx.Client(), ctx.Identities, ctx.Clock, ctx.Logger);
            var result = await service.RegisterAsync(
                ctx.Args.Required("--token"),
                ctx.Args.Optional("--game-version"),
                force: ctx.Args.Has("--force"),
                ct).ConfigureAwait(false);
            return new
            {
                result.ServerId,
                result.KeyFingerprint,
                result.Status,
                IdentityPath = ctx.Identities.Store.IdentityPath,
            };
        }

        public static async Task<object> TimeAsync(CliContext ctx, CancellationToken ct)
        {
            var before = ctx.Clock.UtcNow;
            var response = await ctx.Client().GetTimeAsync(ct).ConfigureAwait(false);
            var after = ctx.Clock.UtcNow;
            var midpointMs = before.ToUnixTimeMilliseconds() + (after.ToUnixTimeMilliseconds() - before.ToUnixTimeMilliseconds()) / 2;
            return new
            {
                response.ServerTime,
                response.EpochMs,
                LocalEpochMs = midpointMs,
                SkewMs = response.EpochMs - midpointMs,
                RoundTripMs = after.ToUnixTimeMilliseconds() - before.ToUnixTimeMilliseconds(),
            };
        }

        public static async Task<object> HeartbeatAsync(CliContext ctx, CancellationToken ct)
        {
            ctx.RequireRegistered();
            var request = new ServerHeartbeatRequest
            {
                PluginVersion = TrustInfo.PluginVersion,
                GameVersion = ctx.Args.Optional("--game-version"),
                PlayerCount = ctx.Args.Optional("--players") != null ? ctx.Args.IntOption("--players", 0, 0, 1000) : null,
            };
            return await ctx.Client().HeartbeatAsync(request, null, ct).ConfigureAwait(false);
        }

        public static async Task<object> RotateAsync(CliContext ctx, CancellationToken ct)
        {
            ctx.RequireRegistered();
            var service = new KeyRotationService(
                ctx.Client(),
                ctx.Identities,
                () => new ServerHeartbeatRequest { PluginVersion = TrustInfo.PluginVersion },
                ctx.Clock,
                ctx.Logger);
            if (service.HasPendingRecovery)
            {
                var outcome = await service.RecoverAsync(ct).ConfigureAwait(false);
                return new
                {
                    Recovered = outcome,
                    Note = "An interrupted rotation was resolved first; run 'rotate' again for a fresh rotation.",
                };
            }

            var result = await service.RotateAsync(ct).ConfigureAwait(false);
            return new
            {
                result.PreviousFingerprint,
                result.NewFingerprint,
                result.PreviousKeyRetiringUntil,
            };
        }

        public static async Task<object> CheckAsync(CliContext ctx, CancellationToken ct)
        {
            ctx.RequireRegistered();
            var request = new PlayerCheckRequest
            {
                Player = ctx.Args.Player("--player"),
                Nickname = ctx.Args.Optional("--nickname"),
                Ip = ctx.Args.Optional("--ip"),
                AccountCreatedAt = ctx.Args.IsoOption("--account-created-at"),
            };
            return await ctx.Client().CheckPlayerAsync(request, ct).ConfigureAwait(false);
        }

        public static async Task<object> BypassAsync(CliContext ctx, CancellationToken ct)
        {
            ctx.RequireRegistered();
            var request = new BypassCheckRequest
            {
                Player = ctx.Args.Player("--player"),
                Ip = ctx.Args.Optional("--ip"),
                Types = ParseBypassTypes(ctx.Args.Optional("--types")),
            };
            return await ctx.Client().CheckBypassAsync(request, ct).ConfigureAwait(false);
        }

        public static async Task<object> LinkAsync(CliContext ctx, CancellationToken ct)
        {
            ctx.RequireRegistered();
            var request = new PlayerLinkRequest
            {
                Player = ctx.Args.Player("--player"),
                Code = ctx.Args.Required("--code"),
            };
            return await ctx.Client().LinkPlayerAsync(request, ct).ConfigureAwait(false);
        }

        public static async Task<object> ReportAsync(CliContext ctx, CancellationToken ct)
        {
            ctx.RequireRegistered();
            var reporterRaw = ctx.Args.Optional("--reporter");
            var request = new ServerReportRequest
            {
                Player = ctx.Args.Player("--player"),
                Reporter = reporterRaw != null ? ctx.Args.Player("--reporter") : null,
                Reason = ctx.Args.Required("--reason"),
                Description = ctx.Args.Optional("--description"),
                LogExcerpt = ReadLogExcerpt(ctx),
            };
            return await ctx.Client().SubmitReportAsync(request, ct).ConfigureAwait(false);
        }

        public static async Task<object> PolicyAsync(CliContext ctx, CancellationToken ct)
        {
            ctx.RequireRegistered();
            return await ctx.Client().GetPolicyAsync(ct).ConfigureAwait(false);
        }

        /// <summary>
        /// Starts an Overwatch proof session, prints the proof code of every window plus heartbeats
        /// for --seconds, then ends the session. Mirrors the plugin's spectate flow end to end.
        /// </summary>
        public static async Task<object> OverwatchAsync(CliContext ctx, CancellationToken ct)
        {
            var identity = ctx.RequireRegistered();
            var target = ctx.Args.Player("--target");
            var spectator = ctx.Args.Player("--spectator");
            var seconds = ctx.Args.IntOption("--seconds", 30, 1, 3600);
            var client = ctx.Client();

            var start = await client.StartOverwatchSessionAsync(new OverwatchSessionStartRequest
            {
                TargetPlayer = target,
                Spectator = spectator,
                StartedAt = ctx.Clock.UtcNow,
            }, ct).ConfigureAwait(false);

            var secret = Convert.FromBase64String(start.Secret);
            var sessionId = start.SessionId.ToString("D");
            var serverId = identity.ServerId!;
            var targetUserId = target.ToUserId();
            var spectatorUserId = spectator.ToUserId();
            Print(new
            {
                Event = "session_started",
                start.SessionId,
                start.IntervalSeconds,
                start.HeartbeatIntervalSeconds,
                start.StartedAt,
                start.ServerTime,
            });

            var deadline = ctx.Clock.UtcNow.AddSeconds(seconds);
            var nextHeartbeat = ctx.Clock.UtcNow.AddSeconds(start.HeartbeatIntervalSeconds);
            long lastWindow = -1;
            while (ctx.Clock.UtcNow < deadline && !ct.IsCancellationRequested)
            {
                var now = ctx.Clock.UtcNow;
                var unixSeconds = now.ToUnixTimeSeconds();
                var window = ProofCodeGenerator.Window(unixSeconds, start.IntervalSeconds);
                if (window != lastWindow)
                {
                    lastWindow = window;
                    var code = ProofCodeGenerator.Generate(secret, sessionId, serverId, targetUserId, spectatorUserId, unixSeconds, start.IntervalSeconds);
                    Print(new
                    {
                        Event = "proof_code",
                        Window = window,
                        Code = code,
                        WindowStart = DateTimeOffset.FromUnixTimeSeconds(window * start.IntervalSeconds),
                        WindowEnd = DateTimeOffset.FromUnixTimeSeconds((window + 1) * start.IntervalSeconds),
                        Overlay = ProofOverlay.Format(code, now, serverId, start.SessionId),
                    });
                }

                if (now >= nextHeartbeat)
                {
                    nextHeartbeat = now.AddSeconds(start.HeartbeatIntervalSeconds);
                    var beat = await client.OverwatchHeartbeatAsync(start.SessionId, ct).ConfigureAwait(false);
                    Print(new { Event = "heartbeat", beat.SessionId, beat.Status, beat.LastHeartbeatAt });
                }

                await Task.Delay(TimeSpan.FromMilliseconds(250), ct).ConfigureAwait(false);
            }

            var end = await client.EndOverwatchSessionAsync(start.SessionId, OverwatchEndReason.Manual, CancellationToken.None).ConfigureAwait(false);
            return new { Event = "session_ended", end.SessionId, end.Status, end.EndedAt };
        }

        internal static void Print(object value) => Console.WriteLine(TrustJson.Serialize(value, indented: true));

        private static List<BypassType>? ParseBypassTypes(string? raw)
        {
            if (string.IsNullOrWhiteSpace(raw))
            {
                return null;
            }

            var types = new List<BypassType>();
            foreach (var part in raw!.Split(','))
            {
                try
                {
                    types.Add(TrustJson.Deserialize<BypassType>("\"" + part.Trim() + "\""));
                }
                catch (System.Text.Json.JsonException)
                {
                    throw new CliUsageException("--types: unknown bypass type '" + part.Trim()
                        + "' (use vpn_whitelist, account_age_whitelist, alt_account_whitelist or verdict_override).");
                }
            }

            return types;
        }

        private static string? ReadLogExcerpt(CliContext ctx)
        {
            var inline = ctx.Args.Optional("--log-excerpt");
            var file = ctx.Args.Optional("--log-excerpt-file");
            if (inline != null && file != null)
            {
                throw new CliUsageException("Use either --log-excerpt or --log-excerpt-file, not both.");
            }

            if (file == null)
            {
                return inline;
            }

            if (!File.Exists(file))
            {
                throw new CliUsageException("--log-excerpt-file: '" + file + "' does not exist.");
            }

            return File.ReadAllText(file);
        }
    }
}
