using System;
using LabApi.Loader.Features.Plugins;
using ScpslTrust.Core;
using ScpslTrust.Core.Config;
using ScpslTrust.Plugin.Runtime;

namespace ScpslTrust.Plugin
{
    /// <summary>
    /// LabAPI entry point. All logic lives in <see cref="TrustRuntime"/> (composition root) and in
    /// ScpslTrust.Core; this class only follows the plugin lifecycle.
    /// </summary>
    public sealed class TrustPlugin : Plugin<TrustConfig>
    {
        private TrustRuntime? _runtime;

        /// <summary>The enabled plugin instance, or null while disabled.</summary>
        public static TrustPlugin? Instance { get; private set; }

        /// <summary>Runtime of the enabled plugin (used by commands, which LabAPI instantiates on its own).</summary>
        internal static TrustRuntime? Runtime => Instance?._runtime;

        public override string Name => TrustInfo.PluginName;

        public override string Description => "SCP:SL Trust Network client: player checks with local policy enforcement, in-game report forwarding and Overwatch proof codes.";

        public override string Author => "SCP:SL Trust Network";

        public override Version Version => new Version(TrustInfo.PluginVersion);

        /// <summary>Built and tested against LabAPI 1.1.7 (the loader accepts any 1.x).</summary>
        public override Version RequiredApiVersion => new Version(1, 1, 7);

        /// <summary>Administrative tool: it never changes gameplay balance or the user interface beyond hints.</summary>
        public override bool IsTransparent => true;

        public override void Enable()
        {
            if (_runtime != null)
            {
                return;
            }

            Instance = this;
            _runtime = new TrustRuntime(this);
            _runtime.Start();
        }

        public override void Disable()
        {
            var runtime = _runtime;
            _runtime = null;
            runtime?.Stop();
            if (ReferenceEquals(Instance, this))
            {
                Instance = null;
            }
        }
    }
}
