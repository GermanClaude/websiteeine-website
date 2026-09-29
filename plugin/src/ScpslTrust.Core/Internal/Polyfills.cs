// Compiler support types missing from netstandard2.0. Internal, so they never clash with the
// runtime's own definitions (the game's Mono mscorlib and .NET 8 ship public versions).
#if NETSTANDARD2_0

namespace System.Runtime.CompilerServices
{
    internal static class IsExternalInit
    {
    }
}

namespace System.Diagnostics.CodeAnalysis
{
    [AttributeUsage(AttributeTargets.Parameter)]
    internal sealed class NotNullWhenAttribute : Attribute
    {
        public NotNullWhenAttribute(bool returnValue) => ReturnValue = returnValue;

        public bool ReturnValue { get; }
    }

    [AttributeUsage(AttributeTargets.Parameter)]
    internal sealed class MaybeNullWhenAttribute : Attribute
    {
        public MaybeNullWhenAttribute(bool returnValue) => ReturnValue = returnValue;

        public bool ReturnValue { get; }
    }

    [AttributeUsage(AttributeTargets.Method)]
    internal sealed class DoesNotReturnAttribute : Attribute
    {
    }
}

#endif
