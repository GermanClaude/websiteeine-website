using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using MEC;
using ScpslTrust.Core.Abstractions;

namespace ScpslTrust.Plugin.Runtime
{
    /// <summary>
    /// Main-thread dispatcher backed by a MEC coroutine: queued actions are drained every frame with a
    /// per-frame budget so background work (HTTP responses) can touch the game API safely.
    /// </summary>
    internal sealed class MecMainThreadDispatcher : IMainThreadDispatcher
    {
        private const int MaxActionsPerFrame = 64;
        private static readonly TimeSpan FrameBudget = TimeSpan.FromMilliseconds(4);

        private readonly ConcurrentQueue<Action> _queue = new ConcurrentQueue<Action>();
        private readonly ITrustLogger _logger;
        private readonly int _mainThreadId;
        private CoroutineHandle _pump;
        private volatile bool _running;

        /// <summary>Must be constructed on the main thread (plugin Enable).</summary>
        public MecMainThreadDispatcher(ITrustLogger logger)
        {
            _logger = logger ?? throw new ArgumentNullException(nameof(logger));
            _mainThreadId = Thread.CurrentThread.ManagedThreadId;
        }

        public bool IsMainThread => Thread.CurrentThread.ManagedThreadId == _mainThreadId;

        public bool IsRunning => _running;

        public int PendingCount => _queue.Count;

        public void Post(Action action)
        {
            if (action == null)
            {
                throw new ArgumentNullException(nameof(action));
            }

            _queue.Enqueue(action);
        }

        public void Start()
        {
            if (_running)
            {
                return;
            }

            _running = true;
            _pump = Timing.RunCoroutine(Pump());
        }

        /// <summary>Stops draining; actions still queued are discarded (the game API must not be used after disable).</summary>
        public void Stop()
        {
            _running = false;
            Timing.KillCoroutines(_pump);
            while (_queue.TryDequeue(out _))
            {
            }
        }

        private IEnumerator<float> Pump()
        {
            while (_running)
            {
                Drain();
                yield return Timing.WaitForOneFrame;
            }
        }

        private void Drain()
        {
            var stopwatch = Stopwatch.StartNew();
            var executed = 0;
            while (executed < MaxActionsPerFrame && stopwatch.Elapsed < FrameBudget && _queue.TryDequeue(out var action))
            {
                executed++;
                try
                {
                    action();
                }
                catch (Exception ex)
                {
                    _logger.Error("Main-thread action failed: " + ex.GetType().Name + ": " + ex.Message);
                }
            }
        }
    }
}
