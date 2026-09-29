using System;
using System.Net;

namespace ScpslTrust.Core.Api
{
    /// <summary>Connection settings of <see cref="TrustApiClient"/>.</summary>
    public sealed class TrustApiClientOptions
    {
        public const string ApiPrefix = "/api/v1";

        public TrustApiClientOptions(Uri baseUri, string pluginVersion)
        {
            BaseUri = baseUri ?? throw new ArgumentNullException(nameof(baseUri));
            if (string.IsNullOrWhiteSpace(pluginVersion))
            {
                throw new ArgumentException("Plugin version is required.", nameof(pluginVersion));
            }

            PluginVersion = pluginVersion;
        }

        /// <summary>Normalized backend origin plus optional path prefix, without <c>/api/v1</c> and without trailing slash.</summary>
        public Uri BaseUri { get; }

        public string PluginVersion { get; }

        public TimeSpan RequestTimeout { get; set; } = TimeSpan.FromSeconds(5);

        /// <summary>Extra attempts for idempotent calls (GET /time, GET /servers/policy, heartbeats).</summary>
        public int IdempotentRetries { get; set; } = 1;

        public TimeSpan RetryDelay { get; set; } = TimeSpan.FromMilliseconds(500);

        /// <summary>Responses larger than this are rejected.</summary>
        public int MaxResponseBytes { get; set; } = 1024 * 1024;

        public string UserAgent => "ScpslTrust/" + PluginVersion;

        /// <summary>
        /// Validates and normalizes a configured base URL. HTTPS is required unless the host is a
        /// loopback address or <paramref name="allowInsecureHttp"/> is set. A trailing <c>/api/v1</c> is removed.
        /// </summary>
        public static bool TryNormalizeBaseUrl(string? value, bool allowInsecureHttp, out Uri? baseUri, out string? error)
        {
            baseUri = null;
            error = null;
            if (string.IsNullOrWhiteSpace(value))
            {
                error = "api_base_url is not configured";
                return false;
            }

            if (!Uri.TryCreate(value!.Trim(), UriKind.Absolute, out var uri)
                || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
            {
                error = "api_base_url must be an absolute http(s) URL";
                return false;
            }

            if (!string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment))
            {
                error = "api_base_url must not contain credentials, a query string or a fragment";
                return false;
            }

            if (uri.Scheme == Uri.UriSchemeHttp && !allowInsecureHttp && !IsLoopback(uri))
            {
                error = "api_base_url must use https:// (plain http is only allowed for localhost)";
                return false;
            }

            var path = uri.AbsolutePath.TrimEnd('/');
            if (path.EndsWith(ApiPrefix, StringComparison.OrdinalIgnoreCase))
            {
                path = path.Substring(0, path.Length - ApiPrefix.Length);
            }

            baseUri = new Uri(uri.GetLeftPart(UriPartial.Authority) + path, UriKind.Absolute);
            return true;
        }

        private static bool IsLoopback(Uri uri)
        {
            if (uri.IsLoopback || string.Equals(uri.Host, "localhost", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            return IPAddress.TryParse(uri.Host.Trim('[', ']'), out var address) && IPAddress.IsLoopback(address);
        }
    }
}
