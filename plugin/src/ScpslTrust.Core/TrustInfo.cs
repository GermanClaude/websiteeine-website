namespace ScpslTrust.Core
{
    /// <summary>Product constants sent to the backend.</summary>
    public static class TrustInfo
    {
        /// <summary>Semantic version sent as <c>X-Plugin-Version</c> and <c>plugin_version</c>.</summary>
        public const string PluginVersion = "1.0.0";

        /// <summary>Plugin/folder name used by LabAPI (configs/&lt;port&gt;/ScpslTrust/).</summary>
        public const string PluginName = "ScpslTrust";
    }
}
