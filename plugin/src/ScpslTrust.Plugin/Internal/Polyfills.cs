// Compiler support types missing from net48 reference assemblies. Internal, so they never clash
// with the game's Mono runtime, which resolves nullable attributes at compile time only.
#if NETFRAMEWORK

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
}

#endif
