using System.ComponentModel;
using ScpslTrust.Core.Policy;

namespace ScpslTrust.Core.Config
{
    /// <summary>
    /// Plugin configuration (ARCHITECTURE §17.3), stored by LabAPI as YAML with underscored names
    /// (<c>ApiBaseUrl</c> → <c>api_base_url</c>). Plain settable properties with defaults only;
    /// runtime code reads the validated <see cref="TrustSettings"/> built from it.
    /// </summary>
    public sealed class TrustConfig
    {
        [Description("Base URL of the trust backend, e.g. https://trust.example.org (HTTPS required except for localhost).")]
        public string ApiBaseUrl { get; set; } = string.Empty;

        [Description("Timeout of a single backend request in seconds (1-60).")]
        public int RequestTimeoutSeconds { get; set; } = 5;

        [Description("One-time registration token (sreg_...) from the web panel. Used on first start if no identity exists, then cleared automatically.")]
        public string RegistrationToken { get; set; } = string.Empty;

        [Description("Where the enforcement policy comes from: remote (web panel, cached locally) or local (local_policy below).")]
        public string PolicySource { get; set; } = "remote";

        [Description("How often the remote policy is re-fetched, in seconds (minimum 30).")]
        public int PolicyRefreshSeconds { get; set; } = 300;

        [Description("Check every player against the trust network when they join.")]
        public bool CheckOnJoin { get; set; } = true;

        [Description("Send the player's IP address with the join check for VPN/proxy detection (used transiently, never stored raw).")]
        public bool SendIpForVpnCheck { get; set; } = true;

        [Description("Send an account-creation hint when another plugin provides one (the game itself does not expose account age).")]
        public bool SendAccountAgeHint { get; set; }

        [Description("Forward in-game cheater/player reports to the trust network.")]
        public bool ForwardIngameReports { get; set; } = true;

        [Description("Heartbeat interval in seconds (15-3600).")]
        public int HeartbeatSeconds { get; set; } = 60;

        [Description("How online staff (players with Remote Admin access) are notified.")]
        public StaffNotificationsConfig StaffNotifications { get; set; } = new StaffNotificationsConfig();

        [Description("Overwatch proof codes for recordings of spectated players.")]
        public OverwatchProofConfig OverwatchProof { get; set; } = new OverwatchProofConfig();

        [Description("Remote Admin permissions required for the 'trust' command.")]
        public CommandPermissionsConfig CommandPermissions { get; set; } = new CommandPermissionsConfig();

        [Description("Policy used when policy_source is local (same model as the web panel policy).")]
        public ServerPolicy LocalPolicy { get; set; } = DefaultPolicy.Build();

        [Description("Upper bound for ban durations in minutes; permanent policy bans are capped to it. 0 = unlimited.")]
        public int MaxBanDurationMinutes { get; set; }

        [Description("Verbose logging (never logs keys, signatures or full IP addresses).")]
        public bool Debug { get; set; }
    }

    public sealed class StaffNotificationsConfig
    {
        [Description("Notify online staff about policy matches and enforcement.")]
        public bool Enabled { get; set; } = true;

        [Description("Show notifications as hints on screen.")]
        public bool UseHints { get; set; } = true;

        [Description("Write notifications to the staff member's Remote Admin console.")]
        public bool UseConsole { get; set; } = true;
    }

    public sealed class OverwatchProofConfig
    {
        [Description("Enable Overwatch proof sessions and the on-screen proof code.")]
        public bool Enabled { get; set; } = true;

        [Description("Start a proof session automatically when a staff member spectates a player.")]
        public bool AutoStartOnSpectate { get; set; } = true;

        [Description("Only start automatic sessions while the staff member has Overwatch mode enabled.")]
        public bool OnlyInOverwatch { get; set; } = true;

        [Description("Who may record proof sessions: RemoteAdminAccess, a PlayerPermissions name (e.g. Overwatch) or a LabAPI permission node (e.g. scpsl_trust.proof).")]
        public string RequiredPermission { get; set; } = "RemoteAdminAccess";

        [Description("Vertical offset of the proof overlay in em (TextMeshPro voffset, -50 to 50; negative moves it down).")]
        public float HintVerticalOffset { get; set; } = -10f;
    }

    public sealed class CommandPermissionsConfig
    {
        [Description("Permission for 'trust rotatekey' and 'trust policy reload' (PlayerPermissions name or LabAPI node). 'trust register' is console-only.")]
        public string Admin { get; set; } = "ServerConsoleCommands";

        [Description("Permission for 'trust status', 'trust check' and 'trust policy' (PlayerPermissions name or LabAPI node).")]
        public string Staff { get; set; } = "PlayersManagement";
    }
}
