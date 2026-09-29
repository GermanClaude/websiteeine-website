using System.Collections.Concurrent;
using System.Net;
using System.Text;
using ScpslTrust.Core.Abstractions;

namespace ScpslTrust.Core.Tests.Support;

public sealed class FakeClock : IClock
{
    public FakeClock(DateTimeOffset now) => UtcNow = now;

    public DateTimeOffset UtcNow { get; set; }

    public void Advance(TimeSpan by) => UtcNow += by;
}

public sealed class RecordingLogger : ITrustLogger
{
    public ConcurrentQueue<string> Lines { get; } = new();

    public string All => string.Join("\n", Lines);

    public void Debug(string message) => Lines.Enqueue("DEBUG " + message);

    public void Info(string message) => Lines.Enqueue("INFO " + message);

    public void Warn(string message) => Lines.Enqueue("WARN " + message);

    public void Error(string message) => Lines.Enqueue("ERROR " + message);
}

/// <summary>A captured HTTP request (body bytes exactly as sent).</summary>
public sealed record CapturedRequest(HttpMethod Method, Uri Uri, Dictionary<string, string> Headers, byte[] Body, string? ContentType)
{
    public string BodyText => Encoding.UTF8.GetString(Body);

    public string? Header(string name) => Headers.TryGetValue(name, out var value) ? value : null;
}

/// <summary>HttpMessageHandler that records requests and answers from a script.</summary>
public sealed class RecordingHandler : HttpMessageHandler
{
    private readonly Func<CapturedRequest, int, Task<HttpResponseMessage>> _responder;

    public RecordingHandler(Func<CapturedRequest, int, Task<HttpResponseMessage>> responder) => _responder = responder;

    public List<CapturedRequest> Requests { get; } = new();

    public static RecordingHandler Json(HttpStatusCode status, string json, Action<HttpResponseMessage>? configure = null)
    {
        return new RecordingHandler((_, _) =>
        {
            var response = JsonResponse(status, json);
            configure?.Invoke(response);
            return Task.FromResult(response);
        });
    }

    public static HttpResponseMessage JsonResponse(HttpStatusCode status, string json)
    {
        return new HttpResponseMessage(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var headers = request.Headers.ToDictionary(h => h.Key, h => string.Join(",", h.Value), StringComparer.OrdinalIgnoreCase);
        var body = request.Content == null ? Array.Empty<byte>() : await request.Content.ReadAsByteArrayAsync(cancellationToken);
        var captured = new CapturedRequest(request.Method, request.RequestUri!, headers, body, request.Content?.Headers.ContentType?.ToString());
        int attempt;
        lock (Requests)
        {
            Requests.Add(captured);
            attempt = Requests.Count;
        }

        cancellationToken.ThrowIfCancellationRequested();
        var responseTask = _responder(captured, attempt);
        var completed = await Task.WhenAny(responseTask, Task.Delay(Timeout.Infinite, cancellationToken));
        if (completed != responseTask)
        {
            cancellationToken.ThrowIfCancellationRequested();
        }

        return await responseTask;
    }
}
