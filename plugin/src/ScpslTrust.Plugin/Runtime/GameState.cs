using System;
using System.Threading;
using LabApi.Features.Wrappers;
using ScpslTrust.Core.Abstractions;
using ScpslTrust.Core.Text;

namespace ScpslTrust.Plugin.Runtime
{
    /// <summary>
    /// Snapshot of game facts that background threads may read (heartbeats, report descriptions).
    /// Static facts are captured once on the main thread; the player count is refreshed every second.
    /// </summary>
    internal sealed class GameState
    {
        private int _playerCount;

        private GameState(string gameVersion, string? serverName, int port)
        {
            GameVersion = gameVersion;
            ServerName = serverName;
            Port = port;
        }

        /// <summary>Game build, e.g. <c>14.2.7</c>.</summary>
        public string GameVersion { get; }

        /// <summary>Server list name without rich text, or null when unknown.</summary>
        public string? ServerName { get; }

        public int Port { get; }

        public int PlayerCount => Volatile.Read(ref _playerCount);

        /// <summary>Main thread only.</summary>
        public static GameState Capture(ITrustLogger logger)
        {
            var version = Safe(() => GameCore.Version.VersionString, "unknown", logger, "game version");
            var name = Safe(() => TextSanitizer.CleanLine(TextSanitizer.StripRichText(Server.ServerListName), 100), string.Empty, logger, "server name");
            var port = Safe(() => (int)Server.Port, 0, logger, "server port");
            var state = new GameState(string.IsNullOrWhiteSpace(version) ? "unknown" : version, name.Length == 0 ? null : name, port);
            state.Refresh();
            return state;
        }

        /// <summary>Main thread only.</summary>
        public void Refresh()
        {
            try
            {
                Volatile.Write(ref _playerCount, Server.PlayerCount);
            }
            catch (Exception)
            {
                // The wrapper list may be unavailable during start-up/shutdown; keep the last value.
            }
        }

        private static T Safe<T>(Func<T> read, T fallback, ITrustLogger logger, string what)
        {
            try
            {
                return read();
            }
            catch (Exception ex)
            {
                logger.Warn("Could not read the " + what + ": " + ex.GetType().Name);
                return fallback;
            }
        }
    }
}
