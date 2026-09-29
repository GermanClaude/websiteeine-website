using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace ScpslTrust.Core.Storage
{
    /// <summary>
    /// File helpers: atomic replacement (write temp file in the same directory, flush, rename)
    /// and owner-only permissions (chmod 600) on Unix-like systems.
    /// </summary>
    public static class SecureFile
    {
        private const uint OwnerReadWrite = 0x180; // 0600

        /// <summary>
        /// Atomically replaces <paramref name="path"/> with <paramref name="content"/> (UTF-8, no BOM).
        /// With <paramref name="ownerOnly"/> the temp file is restricted before any content is written.
        /// </summary>
        public static void WriteAllTextAtomic(string path, string content, bool ownerOnly)
        {
            if (path == null)
            {
                throw new ArgumentNullException(nameof(path));
            }

            var fullPath = Path.GetFullPath(path);
            var directory = Path.GetDirectoryName(fullPath) ?? throw new ArgumentException("Path has no directory.", nameof(path));
            Directory.CreateDirectory(directory);
            var tempPath = Path.Combine(directory, "." + Path.GetFileName(fullPath) + "." + Guid.NewGuid().ToString("N") + ".tmp");
            var bytes = new UTF8Encoding(false).GetBytes(content ?? string.Empty);
            try
            {
                using (var stream = new FileStream(tempPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    if (ownerOnly)
                    {
                        TryRestrictToOwner(tempPath);
                    }

                    stream.Write(bytes, 0, bytes.Length);
                    stream.Flush(true);
                }

                if (File.Exists(fullPath))
                {
                    File.Replace(tempPath, fullPath, null);
                }
                else
                {
                    File.Move(tempPath, fullPath);
                }

                if (ownerOnly)
                {
                    TryRestrictToOwner(fullPath);
                }
            }
            finally
            {
                if (File.Exists(tempPath))
                {
                    TryDelete(tempPath);
                }

                Array.Clear(bytes, 0, bytes.Length);
            }
        }

        /// <summary>
        /// Sets mode 0600 on Unix-like systems. Returns false when not supported (Windows, missing
        /// libc) or when the call fails; never throws.
        /// </summary>
        public static bool TryRestrictToOwner(string path)
        {
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            {
                return false;
            }

            try
            {
                return NativeMethods.Chmod(path, OwnerReadWrite) == 0;
            }
            catch (DllNotFoundException)
            {
                return TryChmodFallback(path);
            }
            catch (EntryPointNotFoundException)
            {
                return TryChmodFallback(path);
            }
            catch (Exception)
            {
                return false;
            }
        }

        /// <summary>Deletes a file if present; never throws.</summary>
        public static bool TryDelete(string path)
        {
            try
            {
                if (File.Exists(path))
                {
                    File.Delete(path);
                }

                return true;
            }
            catch (IOException)
            {
                return false;
            }
            catch (UnauthorizedAccessException)
            {
                return false;
            }
        }

        private static bool TryChmodFallback(string path)
        {
            try
            {
                return NativeMethods.ChmodLibc6(path, OwnerReadWrite) == 0;
            }
            catch (Exception)
            {
                return false;
            }
        }

        private static class NativeMethods
        {
            [DllImport("libc", EntryPoint = "chmod", SetLastError = true, CharSet = CharSet.Ansi, BestFitMapping = false, ThrowOnUnmappableChar = true)]
            internal static extern int Chmod(string path, uint mode);

            [DllImport("libc.so.6", EntryPoint = "chmod", SetLastError = true, CharSet = CharSet.Ansi, BestFitMapping = false, ThrowOnUnmappableChar = true)]
            internal static extern int ChmodLibc6(string path, uint mode);
        }
    }
}
