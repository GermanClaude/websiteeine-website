using System;
using System.Threading.Tasks;

namespace ScpslTrust.Core.Abstractions
{
    /// <summary>
    /// Marshals work onto the game's main thread. Every game API call (kick, ban, hints,
    /// broadcasts, reading player state) must go through this from background code.
    /// </summary>
    public interface IMainThreadDispatcher
    {
        /// <summary>True when called from the main thread.</summary>
        bool IsMainThread { get; }

        /// <summary>Queues an action; it runs on the main thread on a later frame.</summary>
        void Post(Action action);
    }

    public static class MainThreadDispatcherExtensions
    {
        /// <summary>Runs <paramref name="func"/> on the main thread and completes with its result.</summary>
        public static Task<T> InvokeAsync<T>(this IMainThreadDispatcher dispatcher, Func<T> func)
        {
            if (dispatcher == null)
            {
                throw new ArgumentNullException(nameof(dispatcher));
            }

            if (func == null)
            {
                throw new ArgumentNullException(nameof(func));
            }

            var completion = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
            if (dispatcher.IsMainThread)
            {
                Run(func, completion);
                return completion.Task;
            }

            dispatcher.Post(() => Run(func, completion));
            return completion.Task;
        }

        /// <summary>Runs <paramref name="action"/> on the main thread.</summary>
        public static Task InvokeAsync(this IMainThreadDispatcher dispatcher, Action action)
        {
            if (action == null)
            {
                throw new ArgumentNullException(nameof(action));
            }

            return dispatcher.InvokeAsync(() =>
            {
                action();
                return true;
            });
        }

        private static void Run<T>(Func<T> func, TaskCompletionSource<T> completion)
        {
            try
            {
                completion.TrySetResult(func());
            }
            catch (Exception ex)
            {
                completion.TrySetException(ex);
            }
        }
    }

    /// <summary>Dispatcher that runs actions synchronously on the calling thread (tests, tools).</summary>
    public sealed class InlineMainThreadDispatcher : IMainThreadDispatcher
    {
        public static readonly InlineMainThreadDispatcher Instance = new InlineMainThreadDispatcher();

        private InlineMainThreadDispatcher()
        {
        }

        public bool IsMainThread => true;

        public void Post(Action action) => action();
    }
}
