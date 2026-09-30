using System;
using CommandSystem;

namespace ScpslTrust.Plugin.Commands
{
    /// <summary>
    /// Remote Admin / server console parent command <c>trust</c>. LabAPI instantiates it once per
    /// handler (Remote Admin and game console); subcommands are registered in the constructor.
    /// </summary>
    [CommandHandler(typeof(RemoteAdminCommandHandler))]
    [CommandHandler(typeof(GameConsoleCommandHandler))]
    public sealed class TrustCommand : ParentCommand, IUsageProvider
    {
        public TrustCommand()
        {
            LoadGeneratedCommands();
        }

        public override string Command => "trust";

        public override string[] Aliases => Array.Empty<string>();

        public override string Description => "SCP:SL Trust Network: registration, status, player checks, Overwatch proof sessions and policy.";

        public string[] Usage => new[] { "register|status|rotatekey|check|proof|policy" };

        public override void LoadGeneratedCommands()
        {
            RegisterCommand(new RegisterSubcommand());
            RegisterCommand(new StatusSubcommand());
            RegisterCommand(new RotateKeySubcommand());
            RegisterCommand(new CheckSubcommand());
            RegisterCommand(new ProofSubcommand());
            RegisterCommand(new PolicySubcommand());
        }

        protected override bool ExecuteParent(ArraySegment<string> arguments, ICommandSender sender, out string response)
        {
            response = "ScpslTrust commands:\n"
                + "  trust register <sreg_token> [--force]  register this server (server console only)\n"
                + "  trust status                            connection, identity, policy and session status\n"
                + "  trust rotatekey                         generate a new signing key (old key valid during grace)\n"
                + "  trust check <player>                    show trust information and the policy decision (no action)\n"
                + "  trust proof start <player> | stop | list  Overwatch proof sessions\n"
                + "  trust policy [show|reload]              show or reload the enforcement policy";
            return true;
        }
    }
}
