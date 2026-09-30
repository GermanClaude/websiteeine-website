using System;
using System.Linq;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;

namespace ScpslTrust.DevClient
{
    /// <summary>
    /// Negative-test transport for end-to-end runs (e2e/, docs/E2E.md). Never used by the plugin.
    /// <c>--tamper-signature</c> flips one character of <c>X-Signature</c> (backend must answer INVALID_SIGNATURE);
    /// <c>--replay</c> sends every signed request twice with identical headers and returns the second
    /// response (backend must answer REPLAYED_NONCE).
    /// </summary>
    internal sealed class DebugTransport : DelegatingHandler
    {
        private readonly bool _tamperSignature;
        private readonly bool _replay;

        public DebugTransport(bool tamperSignature, bool replay)
            : base(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false })
        {
            _tamperSignature = tamperSignature;
            _replay = replay;
        }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (!request.Headers.Contains("X-Signature"))
            {
                return await base.SendAsync(request, cancellationToken).ConfigureAwait(false);
            }

            if (_tamperSignature)
            {
                var signature = request.Headers.GetValues("X-Signature").First();
                var chars = signature.ToCharArray();
                chars[0] = chars[0] == 'A' ? 'B' : 'A';
                request.Headers.Remove("X-Signature");
                request.Headers.TryAddWithoutValidation("X-Signature", new string(chars));
            }

            if (!_replay)
            {
                return await base.SendAsync(request, cancellationToken).ConfigureAwait(false);
            }

            byte[]? body = request.Content != null
                ? await request.Content.ReadAsByteArrayAsync().ConfigureAwait(false)
                : null;
            var copy = new HttpRequestMessage(request.Method, request.RequestUri);
            foreach (var header in request.Headers)
            {
                copy.Headers.TryAddWithoutValidation(header.Key, header.Value);
            }

            if (body != null)
            {
                copy.Content = new ByteArrayContent(body);
                foreach (var header in request.Content!.Headers)
                {
                    copy.Content.Headers.TryAddWithoutValidation(header.Key, header.Value);
                }
            }

            using (var first = await base.SendAsync(request, cancellationToken).ConfigureAwait(false))
            {
                Console.Error.WriteLine("[debug] replay: first response " + (int)first.StatusCode);
            }

            return await base.SendAsync(copy, cancellationToken).ConfigureAwait(false);
        }
    }
}
