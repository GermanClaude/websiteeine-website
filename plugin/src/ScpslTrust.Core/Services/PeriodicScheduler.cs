using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using ScpslTrust.Core.Abstractions;

namespace ScpslTrust.Core.Services
{
    /// <summary>
    /// Runs background jobs on the thread pool at fixed intervals (heartbeat, policy refresh, Overwatch
    /// ticks). Runs of the same job never overlap; failures are logged and the job keeps running.
    /// </summary>
    public sealed class PeriodicScheduler : IDisposable
    {
        private readonly ITrustLogger _logger;
        private readonly List<Job> _jobs = new List<Job>();
        private readonly List<Task> _loops = new List<Task>();
        private CancellationTokenSource? _cancellation;

        public PeriodicScheduler(ITrustLogger logger)
        {
            _logger = logger ?? NullTrustLogger.Instance;
        }

        public bool IsRunning => _cancellation != null;

        /// <summary>Registers a job; must be called before <see cref="Start"/>.</summary>
        public void Add(string name, TimeSpan interval, TimeSpan initialDelay, Func<CancellationToken, Task> action)
        {
            if (IsRunning)
            {
                throw new InvalidOperationException("Jobs must be added before the scheduler starts.");
            }

            if (interval <= TimeSpan.Zero)
            {
                throw new ArgumentOutOfRangeException(nameof(interval));
            }

            _jobs.Add(new Job(name, interval, initialDelay < TimeSpan.Zero ? TimeSpan.Zero : initialDelay, action ?? throw new ArgumentNullException(nameof(action))));
        }

        public void Start()
        {
            if (IsRunning)
            {
                return;
            }

            _cancellation = new CancellationTokenSource();
            var token = _cancellation.Token;
            foreach (var job in _jobs)
            {
                _loops.Add(Task.Run(() => RunLoopAsync(job, token)));
            }
        }

        /// <summary>Cancels all jobs and waits up to <paramref name="timeout"/> for running iterations to finish.</summary>
        public void Stop(TimeSpan timeout)
        {
            var cancellation = _cancellation;
            if (cancellation == null)
            {
                return;
            }

            _cancellation = null;
            cancellation.Cancel();
            try
            {
                Task.WaitAll(_loops.ToArray(), timeout);
            }
            catch (AggregateException)
            {
                // Loops only end through cancellation; exceptions were already logged.
            }

            _loops.Clear();
            cancellation.Dispose();
        }

        public void Dispose() => Stop(TimeSpan.FromSeconds(2));

        private async Task RunLoopAsync(Job job, CancellationToken token)
        {
            try
            {
                await Task.Delay(job.InitialDelay, token).ConfigureAwait(false);
                while (!token.IsCancellationRequested)
                {
                    try
                    {
                        await job.Action(token).ConfigureAwait(false);
                    }
                    catch (OperationCanceledException) when (token.IsCancellationRequested)
                    {
                        return;
                    }
                    catch (Exception ex)
                    {
                        _logger.Error("Background job '" + job.Name + "' failed: " + ex.GetType().Name + ": " + ex.Message);
                    }

                    await Task.Delay(job.Interval, token).ConfigureAwait(false);
                }
            }
            catch (OperationCanceledException)
            {
                // Stopped.
            }
        }

        private sealed class Job
        {
            public Job(string name, TimeSpan interval, TimeSpan initialDelay, Func<CancellationToken, Task> action)
            {
                Name = name;
                Interval = interval;
                InitialDelay = initialDelay;
                Action = action;
            }

            public string Name { get; }

            public TimeSpan Interval { get; }

            public TimeSpan InitialDelay { get; }

            public Func<CancellationToken, Task> Action { get; }
        }
    }
}
