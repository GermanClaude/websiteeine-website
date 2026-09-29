using System;
using System.Collections.Generic;
using ScpslTrust.Core.Api;
using ScpslTrust.Core.Policy;
using ScpslTrust.Core.Security;

namespace ScpslTrust.Core.Config
{
    public enum PolicySourceKind
    {
        Remote,
        Local,
    }

    /// <summary>
    /// Validated, clamped runtime view of <see cref="TrustConfig"/>. Out-of-range values are replaced by the
    /// nearest allowed value and reported as issues; a missing/invalid base URL disables backend access.
    /// </summary>
    public sealed class TrustSettings
    {
        public const int MinRequestTimeoutSeconds = 1;
        public const int MaxRequestTimeoutSeconds = 60;
        public const int MinPolicyRefreshSeconds = 30;
        public const int MinHeartbeatSeconds = 15;
        public const int MaxHeartbeatSeconds = 3600;
        public const float MaxHintOffset = 50f;

        private TrustSettings()
        {
        }

        /// <summary>Normalized backend base URI; null when not configured or invalid.</summary>
        public Uri? ApiBaseUri { get; private set; }

        /// <summary>Why <see cref="ApiBaseUri"/> is null.</summary>
        public string? ApiBaseUriError { get; private set; }

        public TimeSpan RequestTimeout { get; private set; }

        /// <summary>Well-formed registration token from the config, or null.</summary>
        public string? RegistrationToken { get; private set; }

        public PolicySourceKind PolicySource { get; private set; }

        public TimeSpan PolicyRefreshInterval { get; private set; }

        public bool CheckOnJoin { get; private set; }

        public bool SendIpForVpnCheck { get; private set; }

        public bool SendAccountAgeHint { get; private set; }

        public bool ForwardIngameReports { get; private set; }

        public TimeSpan HeartbeatInterval { get; private set; }

        public bool StaffNotificationsEnabled { get; private set; }

        public bool StaffNotificationsUseHints { get; private set; }

        public bool StaffNotificationsUseConsole { get; private set; }

        public bool OverwatchProofEnabled { get; private set; }

        public bool OverwatchAutoStartOnSpectate { get; private set; }

        public bool OverwatchOnlyInOverwatch { get; private set; }

        public string OverwatchRequiredPermission { get; private set; } = "RemoteAdminAccess";

        public float OverwatchHintVerticalOffset { get; private set; }

        public string AdminCommandPermission { get; private set; } = "ServerConsoleCommands";

        public string StaffCommandPermission { get; private set; } = "PlayersManagement";

        public ServerPolicy LocalPolicy { get; private set; } = DefaultPolicy.Build();

        /// <summary>0 = unlimited.</summary>
        public int MaxBanDurationMinutes { get; private set; }

        public bool Debug { get; private set; }

        public static TrustSettings FromConfig(TrustConfig? config, out IReadOnlyList<string> issues)
        {
            config ??= new TrustConfig();
            var problems = new List<string>();
            var settings = new TrustSettings();

            if (TrustApiClientOptions.TryNormalizeBaseUrl(config.ApiBaseUrl, allowInsecureHttp: false, out var baseUri, out var baseError))
            {
                settings.ApiBaseUri = baseUri;
            }
            else
            {
                settings.ApiBaseUriError = baseError;
                if (!string.IsNullOrWhiteSpace(config.ApiBaseUrl))
                {
                    problems.Add(baseError ?? "api_base_url is invalid");
                }
            }

            settings.RequestTimeout = TimeSpan.FromSeconds(Clamp(config.RequestTimeoutSeconds, MinRequestTimeoutSeconds, MaxRequestTimeoutSeconds, "request_timeout_seconds", problems));

            var token = config.RegistrationToken?.Trim();
            if (!string.IsNullOrEmpty(token))
            {
                if (RegistrationTokens.IsValid(token))
                {
                    settings.RegistrationToken = token;
                }
                else
                {
                    problems.Add("registration_token is malformed (expected sreg_ followed by 43 characters)");
                }
            }

            switch ((config.PolicySource ?? string.Empty).Trim().ToLowerInvariant())
            {
                case "remote":
                    settings.PolicySource = PolicySourceKind.Remote;
                    break;
                case "local":
                    settings.PolicySource = PolicySourceKind.Local;
                    break;
                default:
                    problems.Add("policy_source must be 'remote' or 'local'; using remote");
                    settings.PolicySource = PolicySourceKind.Remote;
                    break;
            }

            settings.PolicyRefreshInterval = TimeSpan.FromSeconds(Clamp(config.PolicyRefreshSeconds, MinPolicyRefreshSeconds, int.MaxValue, "policy_refresh_seconds", problems));
            settings.CheckOnJoin = config.CheckOnJoin;
            settings.SendIpForVpnCheck = config.SendIpForVpnCheck;
            settings.SendAccountAgeHint = config.SendAccountAgeHint;
            settings.ForwardIngameReports = config.ForwardIngameReports;
            settings.HeartbeatInterval = TimeSpan.FromSeconds(Clamp(config.HeartbeatSeconds, MinHeartbeatSeconds, MaxHeartbeatSeconds, "heartbeat_seconds", problems));

            var staff = config.StaffNotifications ?? new StaffNotificationsConfig();
            settings.StaffNotificationsEnabled = staff.Enabled;
            settings.StaffNotificationsUseHints = staff.UseHints;
            settings.StaffNotificationsUseConsole = staff.UseConsole;

            var overwatch = config.OverwatchProof ?? new OverwatchProofConfig();
            settings.OverwatchProofEnabled = overwatch.Enabled;
            settings.OverwatchAutoStartOnSpectate = overwatch.AutoStartOnSpectate;
            settings.OverwatchOnlyInOverwatch = overwatch.OnlyInOverwatch;
            settings.OverwatchRequiredPermission = NonEmpty(overwatch.RequiredPermission, "RemoteAdminAccess", "overwatch_proof.required_permission", problems);
            var offset = overwatch.HintVerticalOffset;
            if (float.IsNaN(offset) || float.IsInfinity(offset) || offset < -MaxHintOffset || offset > MaxHintOffset)
            {
                problems.Add("overwatch_proof.hint_vertical_offset must be between -50 and 50; using 0");
                offset = 0f;
            }

            settings.OverwatchHintVerticalOffset = offset;

            var commands = config.CommandPermissions ?? new CommandPermissionsConfig();
            settings.AdminCommandPermission = NonEmpty(commands.Admin, "ServerConsoleCommands", "command_permissions.admin", problems);
            settings.StaffCommandPermission = NonEmpty(commands.Staff, "PlayersManagement", "command_permissions.staff", problems);

            if (config.LocalPolicy == null)
            {
                settings.LocalPolicy = DefaultPolicy.Build();
                if (settings.PolicySource == PolicySourceKind.Local)
                {
                    problems.Add("local_policy is missing; using the default policy");
                }
            }
            else
            {
                settings.LocalPolicy = config.LocalPolicy;
                if (settings.PolicySource == PolicySourceKind.Local)
                {
                    foreach (var issue in PolicyValidator.Validate(config.LocalPolicy))
                    {
                        problems.Add("local_policy: " + issue);
                    }
                }
            }

            settings.MaxBanDurationMinutes = Clamp(config.MaxBanDurationMinutes, 0, PolicyValidator.MaxBanDurationMinutes, "max_ban_duration_minutes", problems);
            settings.Debug = config.Debug;
            issues = problems;
            return settings;
        }

        private static int Clamp(int value, int min, int max, string name, List<string> problems)
        {
            if (value < min)
            {
                problems.Add(name + " must be at least " + min + "; using " + min);
                return min;
            }

            if (value > max)
            {
                problems.Add(name + " must be at most " + max + "; using " + max);
                return max;
            }

            return value;
        }

        private static string NonEmpty(string? value, string fallback, string name, List<string> problems)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                problems.Add(name + " is empty; using " + fallback);
                return fallback;
            }

            return value!.Trim();
        }
    }
}
